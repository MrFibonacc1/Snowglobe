"""H Company agent step — drives a browser UI task (fill a Google Form,
create a ticket, any URL) through H's hosted Computer-Use Agent API.

Modes (H_AGENT_MODE env var):
  mock       (default) simulate a run so the pipeline demos with no keys
  agent_api  RECOMMENDED — H's hosted Agent API (agp.eu.hcompany.ai). Fully
             hosted browser; no local Selenium/Chrome. Verified working.
  nemoclaw   NVIDIA CHALLENGE — sends the task over A2A (JSON-RPC) to a
             HoloDesktop `holo serve` endpoint running inside/alongside
             NemoClaw on an NVIDIA GPU box (Holo 3.1 runs locally there).
             Setup: ../nemoclaw/SETUP.md. Local rehearsal:
             nemoclaw/mock_a2a_server.py.
  surfer_cli LEGACY — the deprecated open-source surfer-h-cli. Upstream is
             unmaintained and its hosted endpoint is dead; kept only as a
             self-hosting escape hatch. Prefer agent_api.

Setup for agent_api:
  pip install -r requirements.txt      # httpx is all we need
  export H_AGENT_MODE=agent_api
  export HAI_API_KEY=hk-...            # from portal.hcompany.ai
  # optional: export HAI_AGENT_REGION=us    (default eu)

config: { "task": "google_form" | "ticket" | "custom_url",
          "url": "<target page>",
          "instructions": "<templated natural-language task>" }
"""

import os
import time

import httpx

# Read at import time for backwards-compatible module-level access, but the
# execute() path re-reads it so a .env loaded after import (see main.py) still
# takes effect.
MODE = os.environ.get("H_AGENT_MODE", "mock")

# Agent API (Computer-Use Agents). EU by default; US via HAI_AGENT_REGION=us.
_REGION = os.environ.get("HAI_AGENT_REGION", "eu").lower()
_DEFAULT_BASE = (
    "https://agp.hcompany.ai/api/v2"
    if _REGION == "us"
    else "https://agp.eu.hcompany.ai/api/v2"
)
AGENT_BASE_URL = os.environ.get("HAI_AGENT_BASE_URL", _DEFAULT_BASE)
AGENT_NAME = os.environ.get("HAI_AGENT_NAME", "h/web-surfer-flash")

TIMEOUT_SEC = int(os.environ.get("H_AGENT_TIMEOUT_SEC", "300"))
POLL_SEC = int(os.environ.get("H_AGENT_POLL_SEC", "5"))

_RUNNING = {"pending", "running", "starting", "queued", "initializing", "created"}


def execute(config: dict, event: dict) -> dict:
    mode = os.environ.get("H_AGENT_MODE", MODE)
    if mode == "agent_api":
        return _run_agent_api(config)
    if mode == "nemoclaw":
        return _run_nemoclaw(config)
    if mode == "surfer_cli":
        from steps import h_agent_surfer_legacy  # deferred: heavy/optional
        return h_agent_surfer_legacy.run(config)
    return _mock(config)


def _run_agent_api(config: dict) -> dict:
    api_key = os.environ.get("HAI_API_KEY")
    if not api_key:
        raise RuntimeError("H_AGENT_MODE=agent_api but HAI_API_KEY is not set")

    # The web agent picks its own start URL, so steer it in the message.
    url = config.get("url")
    instructions = config.get("instructions", "")
    message = f"Go to {url}. {instructions}" if url else instructions

    headers = {"Authorization": f"Bearer {api_key}"}
    started = time.time()

    with httpx.Client(base_url=AGENT_BASE_URL, headers=headers, timeout=30) as client:
        resp = client.post(
            "/sessions",
            json={
                "agent": AGENT_NAME,
                "messages": [{"type": "user_message", "message": message}],
            },
        )
        resp.raise_for_status()
        session = resp.json()
        session_id = session["id"]
        view_url = session.get("agent_view_url")

        # Poll until the session finishes or we hit our time budget.
        last = session
        while time.time() - started < TIMEOUT_SEC:
            time.sleep(POLL_SEC)
            r = client.get(f"/sessions/{session_id}")
            r.raise_for_status()
            last = r.json()
            status = (last.get("status") or {}).get("status")
            if last.get("finished_at") or (status and status not in _RUNNING):
                break

    st = last.get("status") or {}
    return {
        "backend": "agent_api",
        "session_id": session_id,
        "agent_view_url": view_url,   # live/replay link — surface in the dashboard
        "status": st.get("status"),
        "outcome": st.get("outcome"),
        "steps": st.get("steps"),
        "answer": last.get("latest_answer"),
        "duration_sec": round(time.time() - started, 1),
        "task": config.get("task"),
        "url": url,
    }


# --- nemoclaw (NVIDIA Challenge) -------------------------------------------
# Speaks A2A (JSON-RPC 2.0 over HTTP) to HoloDesktop's `holo serve` endpoint
# on the NemoClaw GPU box: message/send to submit, tasks/get to poll.
NEMOCLAW_A2A_URL = os.environ.get("NEMOCLAW_A2A_URL", "http://localhost:8123")

_A2A_RUNNING = {"submitted", "working", "input-required", "auth-required"}


def _run_nemoclaw(config: dict) -> dict:
    import uuid

    url = config.get("url")
    instructions = config.get("instructions", "")
    text = f"Go to {url}. {instructions}" if url else instructions

    started = time.time()
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            NEMOCLAW_A2A_URL,
            json={
                "jsonrpc": "2.0",
                "id": uuid.uuid4().hex,
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"kind": "text", "text": text}],
                        "messageId": uuid.uuid4().hex,
                    }
                },
            },
        )
        resp.raise_for_status()
        result = resp.json().get("result", {})

        # Result may be an immediate Message or a long-running Task.
        if result.get("kind") == "message":
            return _nemoclaw_output(result, "completed", started, config)

        task_id = result.get("id")
        state = ((result.get("status") or {}).get("state") or "submitted").lower()
        last = result
        while state in _A2A_RUNNING and time.time() - started < TIMEOUT_SEC:
            time.sleep(POLL_SEC)
            r = client.post(
                NEMOCLAW_A2A_URL,
                json={
                    "jsonrpc": "2.0",
                    "id": uuid.uuid4().hex,
                    "method": "tasks/get",
                    "params": {"id": task_id},
                },
            )
            r.raise_for_status()
            last = r.json().get("result", {})
            state = ((last.get("status") or {}).get("state") or state).lower()

    return _nemoclaw_output(last, state, started, config)


def _a2a_text(obj: dict) -> str | None:
    """Pull text out of an A2A Message or Task (artifacts / status message)."""
    parts = list(obj.get("parts") or [])
    for artifact in obj.get("artifacts") or []:
        parts += artifact.get("parts") or []
    status_msg = (obj.get("status") or {}).get("message") or {}
    parts += status_msg.get("parts") or []
    texts = [p.get("text") for p in parts if p.get("kind") == "text" and p.get("text")]
    return "\n".join(texts) if texts else None


def _nemoclaw_output(last: dict, state: str | None, started: float, config: dict) -> dict:
    return {
        "backend": "nemoclaw",
        "a2a_url": NEMOCLAW_A2A_URL,
        "task_id": last.get("id"),
        "state": state or "completed",
        "answer": _a2a_text(last),
        "duration_sec": round(time.time() - started, 1),
        "task": config.get("task"),
        "url": config.get("url"),
    }


def _mock(config: dict) -> dict:
    # Simulates agent latency so the dashboard's live runs view shows a
    # believable running -> done progression during keyless demos.
    time.sleep(4)
    return {
        "backend": "mock",
        "task": config.get("task"),
        "url": config.get("url"),
        "summary": f"[mock] agent would open {config.get('url')} and: "
                   f"{config.get('instructions', '')[:160]}",
        "answer": None,
        "agent_view_url": None,
    }
