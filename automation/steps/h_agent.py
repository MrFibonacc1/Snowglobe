"""H Company agent step — drives a browser UI task (fill a Google Form,
create a ticket, any URL) through an H agent.

Modes (H_AGENT_MODE env var):
  mock        (default) simulate a run so the pipeline demos with no keys
  surfer_cli  shell out to H's surfer-h-cli (github.com/hcompai/surfer-h-cli)

surfer_cli setup (see automation/NOTES.md for the full walkthrough):
  1. git clone https://github.com/hcompai/surfer-h-cli && install uv
  2. export SURFER_H_CLI_DIR=/path/to/surfer-h-cli
  3. export HAI_API_KEY=...       # from portal.hcompany.ai
     export HAI_MODEL_URL=...    # hosted Holo endpoint (or local vLLM)
     export HAI_MODEL_NAME=...
  4. export H_AGENT_MODE=surfer_cli

config: { "task": "google_form" | "ticket" | "custom_url",
          "url": "<target page>",
          "instructions": "<templated natural-language task>" }
"""

import os
import subprocess
import time

MODE = os.environ.get("H_AGENT_MODE", "mock")
CLI_DIR = os.environ.get("SURFER_H_CLI_DIR", "")
MAX_STEPS = int(os.environ.get("H_AGENT_MAX_STEPS", "30"))
TIMEOUT_SEC = int(os.environ.get("H_AGENT_TIMEOUT_SEC", "300"))


def execute(config: dict, event: dict) -> dict:
    if MODE == "surfer_cli":
        return _run_surfer_cli(config)
    return _mock(config)


def _run_surfer_cli(config: dict) -> dict:
    if not CLI_DIR:
        raise RuntimeError("H_AGENT_MODE=surfer_cli but SURFER_H_CLI_DIR is not set")
    cmd = [
        "uv", "run", "src/surfer_h_cli/surferh.py",
        "--task", config["instructions"],
        "--url", config["url"],
        "--max_n_steps", str(MAX_STEPS),
    ]
    started = time.time()
    proc = subprocess.run(
        cmd,
        cwd=CLI_DIR,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SEC,
        env=os.environ.copy(),  # passes HAI_API_KEY / HAI_MODEL_URL / HAI_MODEL_NAME
    )
    # Keep the tail of the trajectory log — the dashboard shows it as the
    # "what the agent did" trace. Retry once on failure: agent runs are flaky.
    tail = "\n".join(proc.stdout.splitlines()[-30:])
    if proc.returncode != 0:
        proc = subprocess.run(
            cmd, cwd=CLI_DIR, capture_output=True, text=True,
            timeout=TIMEOUT_SEC, env=os.environ.copy(),
        )
        tail = "\n".join(proc.stdout.splitlines()[-30:])
        if proc.returncode != 0:
            raise RuntimeError(
                f"surfer-h failed twice; stderr tail: {proc.stderr[-500:]}"
            )
    return {
        "backend": "surfer_cli",
        "task": config.get("task"),
        "url": config["url"],
        "duration_sec": round(time.time() - started, 1),
        "trajectory_tail": tail,
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
        "replay_url": None,
    }
