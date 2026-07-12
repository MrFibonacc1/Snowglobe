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

_SAFE_DIAGNOSTICS = {
    "backend", "agent", "session_id", "task_id", "agent_view_url",
    "status", "state", "outcome", "steps", "duration_sec", "task", "url",
}


class AgentExecutionError(RuntimeError):
    """The real agent did not produce a terminal, usable result."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.details = {
            key: value for key, value in (details or {}).items()
            if key in _SAFE_DIAGNOSTICS and value is not None
        }


def _require_terminal_answer(output: dict, running_states: set[str]) -> dict:
    """Fail closed when an agent is unfinished or has no downstream-safe answer."""
    status = str(output.get("status") or output.get("state") or "").lower()
    backend = output.get("backend", "agent")
    if status in running_states:
        raise AgentExecutionError(
            f"{backend} exceeded its time budget while status={status}; no completed answer was produced",
            output,
        )
    answer = output.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        raise AgentExecutionError(
            f"{backend} reached status={status or 'unknown'} without a usable answer",
            output,
        )
    return output


def execute(config: dict, event: dict, progress=None) -> dict:
    mode = os.environ.get("H_AGENT_MODE", MODE)
    if mode == "agent_api":
        return _run_agent_api(config, progress=progress)
    if mode == "agent_mcp":
        return _run_agent_mcp(config)
    if mode == "nemoclaw":
        return _run_nemoclaw(config)
    if mode == "surfer_cli":
        from steps import h_agent_surfer_legacy  # deferred: heavy/optional
        return h_agent_surfer_legacy.run(config)
    return _mock(config)


def _run_agent_api(config: dict, progress=None) -> dict:
    api_key = os.environ.get("HAI_API_KEY")
    if not api_key:
        raise RuntimeError("H_AGENT_MODE=agent_api but HAI_API_KEY is not set")

    # The web agent picks its own start URL, so steer it in the message.
    url = config.get("url")
    instructions = config.get("instructions", "")
    message = f"Go to {url}. {instructions}" if url else instructions
    # Per-step agent choice (a preset like h/web-surfer-pro or a custom agent
    # built in the H console), falling back to the env default.
    agent = config.get("agent") or AGENT_NAME

    headers = {"Authorization": f"Bearer {api_key}"}
    started = time.time()
    # Long missions can override the global budget per step:
    # config {"timeout_sec": 1200} → wait up to 20 min for this one task.
    budget = int(config.get("timeout_sec", TIMEOUT_SEC))

    with httpx.Client(base_url=AGENT_BASE_URL, headers=headers, timeout=30) as client:
        resp = client.post(
            "/sessions",
            json={
                "agent": agent,
                "messages": [{"type": "user_message", "message": message}],
            },
        )
        resp.raise_for_status()
        session = resp.json()
        session_id = session["id"]
        view_url = session.get("agent_view_url")

        def _emit(extra: dict) -> None:
            if not progress:
                return
            try:
                progress({
                    "backend": "agent_api",
                    "agent": agent,
                    "session_id": session_id,
                    "status": "running",
                    "task": config.get("task"),
                    "url": url,
                    **extra,
                })
            except Exception:  # noqa: BLE001 — progress is best-effort
                pass

        # Announce the session immediately; the live view URL often isn't in the
        # POST /sessions response, so we also publish it from the poll loop below
        # the moment H exposes it.
        _emit({"agent_view_url": view_url} if view_url else {})
        published_view = bool(view_url)

        # Poll until the session finishes or we hit our time budget.
        last = session
        while time.time() - started < budget:
            time.sleep(POLL_SEC)
            r = client.get(f"/sessions/{session_id}")
            r.raise_for_status()
            last = r.json()
            # Surface the live view URL as soon as it appears, so the dashboard
            # can link out to watch the agent's browser while it's still working
            # (H blocks iframe embedding, so the UI opens it in a new tab).
            if not published_view:
                vu = last.get("agent_view_url")
                if vu:
                    view_url = vu
                    published_view = True
                    _emit({"agent_view_url": vu})
            status = (last.get("status") or {}).get("status")
            if last.get("finished_at") or (status and status not in _RUNNING):
                break

        # A session can finish between the last scheduled poll and the exact
        # budget boundary. Fetch once more before classifying it as timed out;
        # this adds only one bounded API request and avoids returning a stale
        # `running` snapshot when H already has the terminal answer.
        last_status = ((last.get("status") or {}).get("status") or "").lower()
        if not last.get("finished_at") and last_status in _RUNNING:
            final = client.get(f"/sessions/{session_id}")
            final.raise_for_status()
            last = final.json()

    # Belt-and-suspenders: if we never captured the live view URL during
    # polling, take it from the final snapshot so the run still links out.
    if not view_url:
        view_url = last.get("agent_view_url")

    st = last.get("status") or {}
    return _require_terminal_answer({
        "backend": "agent_api",
        "agent": agent,
        "session_id": session_id,
        "agent_view_url": view_url,   # live/replay link — surface in the dashboard
        "status": st.get("status"),
        "outcome": st.get("outcome"),
        "steps": st.get("steps"),
        "answer": last.get("latest_answer"),
        "duration_sec": round(time.time() - started, 1),
        "task": config.get("task"),
        "url": url,
    }, _RUNNING)


# --- agent_mcp: H agents via their official hosted MCP server ---------------
# The same surface the NemoClaw-sandboxed harness uses (see nemoclaw/SETUP.md):
# run_agent -> wait_for_session -> share_session on agp.<region>.hcompany.ai/mcp.
# config extras: "agent" (default HAI_AGENT_NAME), "share": true for a public
# replay URL (surfaced as agent_view_url in the runs view).
HAI_MCP_URL = os.environ.get(
    "HAI_MCP_URL",
    "https://agp.hcompany.ai/mcp" if _REGION == "us" else "https://agp.eu.hcompany.ai/mcp",
)

_MCP_RUNNING = {"pending", "running", "starting", "queued", "created", "initializing"}


def _run_agent_mcp(config: dict) -> dict:
    import json as _json

    from steps import mcp_step

    api_key = os.environ.get("HAI_API_KEY")
    if not api_key:
        raise RuntimeError("H_AGENT_MODE=agent_mcp but HAI_API_KEY is not set")

    url = config.get("url")
    instructions = config.get("instructions", "")
    task = f"Go to {url}. {instructions}" if url else instructions
    agent = config.get("agent", AGENT_NAME)
    budget = int(config.get("timeout_sec", TIMEOUT_SEC))
    started = time.time()

    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    def tool(client: httpx.Client, name: str, arguments: dict):
        call = mcp_step._rpc(client, HAI_MCP_URL, "tools/call", {
            "name": name, "arguments": arguments,
        })
        result = call["body"].get("result", {})
        texts = [c.get("text", "") for c in result.get("content", [])
                 if c.get("type") == "text"]
        raw = "\n".join(texts)
        if result.get("isError"):
            raise RuntimeError(f"{name} errored: {raw[:300]}")
        try:
            parsed = _json.loads(raw)
            return parsed if isinstance(parsed, dict) else {"text": raw}
        except (ValueError, TypeError):
            return {"text": raw}

    with httpx.Client(timeout=120, headers=headers) as client:
        init = mcp_step._rpc(client, HAI_MCP_URL, "initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "snowglobe-automation", "version": "0.1"},
        })
        session_hdr = init["headers"].get("mcp-session-id")
        if session_hdr:
            client.headers["Mcp-Session-Id"] = session_hdr
        try:
            client.post(HAI_MCP_URL, json={
                "jsonrpc": "2.0", "method": "notifications/initialized",
            })
        except httpx.HTTPError:
            pass

        res = tool(client, "run_agent", {
            "task": task, "agent": agent, "max_time_s": budget,
        })
        session_id = res.get("session_id") or res.get("id")
        answer = res.get("answer") or res.get("latest_answer") or (
            res.get("text") if not session_id else None
        )
        status = _mcp_status(res)

        # No answer yet -> long-poll the session until answer or budget.
        while not answer and session_id and time.time() - started < budget:
            snap = tool(client, "wait_for_session", {
                "session_id": session_id, "wait": True,
            })
            answer = snap.get("answer") or snap.get("latest_answer")
            status = _mcp_status(snap) or status
            if answer or (status and status not in _MCP_RUNNING):
                break

        share_url = None
        if session_id and config.get("share"):
            try:
                sh = tool(client, "share_session", {"session_id": session_id})
                share_url = sh.get("share_url") or sh.get("url") or sh.get("text")
            except Exception:  # noqa: BLE001 — sharing is best-effort
                pass

    return _require_terminal_answer({
        "backend": "agent_mcp",
        "agent": agent,
        "session_id": session_id,
        "status": status,
        "answer": answer,
        "agent_view_url": share_url,  # public replay; runs view links it
        "duration_sec": round(time.time() - started, 1),
        "task": config.get("task"),
        "url": url,
    }, _MCP_RUNNING)


def _mcp_status(obj: dict):
    st = obj.get("status")
    if isinstance(st, dict):
        return st.get("status") or st.get("state")
    return st


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
    budget = int(config.get("timeout_sec", TIMEOUT_SEC))
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
        while state in _A2A_RUNNING and time.time() - started < budget:
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
    return _require_terminal_answer({
        "backend": "nemoclaw",
        "a2a_url": NEMOCLAW_A2A_URL,
        "task_id": last.get("id"),
        "state": state or "completed",
        "answer": _a2a_text(last),
        "duration_sec": round(time.time() - started, 1),
        "task": config.get("task"),
        "url": config.get("url"),
    }, _A2A_RUNNING)


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
