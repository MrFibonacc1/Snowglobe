"""H Company agent step — drives a browser UI task (fill a Google Form,
create a ticket, any URL) through H's open Surfer-H agent.

Modes (H_AGENT_MODE env var):
  mock        (default) simulate a run so the pipeline demos with no keys
  surfer_cli  invoke the real surfer-h-cli (github.com/hcompai/surfer-h-cli)

The command mirrors the repo's run-on-holo.sh: navigation + localization both
point at the hosted Holo model, API keys come from HAI_API_KEY. Set up the
CLI + its client venv with automation/setup_h_agent.sh, then:

  export H_AGENT_MODE=surfer_cli
  export HAI_API_KEY=...            # from portal.hcompany.ai
  # optional overrides (defaults match surfer-h-cli/.env.example):
  # export HAI_MODEL_URL=https://api.hcompanyprod.fr/v1/models/holo1-7b-20250521
  # export HAI_MODEL_NAME=holo1-7b-20250521

config: { "task": "google_form" | "ticket" | "custom_url",
          "url": "<target page>",
          "instructions": "<templated natural-language task>" }
"""

import os
import re
import subprocess
import time

MODE = os.environ.get("H_AGENT_MODE", "mock")

# Where the surfer-h-cli repo lives, and its client-venv console script.
# Defaults assume it was cloned next to automation/ (companyH/surfer-h-cli)
# and set up via setup_h_agent.sh.
_DEFAULT_CLI_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "surfer-h-cli")
)
CLI_DIR = os.environ.get("SURFER_H_CLI_DIR", _DEFAULT_CLI_DIR)
SURFER_H_BIN = os.environ.get(
    "SURFER_H_BIN", os.path.join(CLI_DIR, ".venv", "bin", "surfer-h-cli")
)

# Hosted Holo defaults (from surfer-h-cli/.env.example).
MODEL_URL = os.environ.get("HAI_MODEL_URL", "https://api.hcompanyprod.fr/v1/models/holo1-7b-20250521")
MODEL_NAME = os.environ.get("HAI_MODEL_NAME", "holo1-7b-20250521")

MAX_STEPS = int(os.environ.get("H_AGENT_MAX_STEPS", "30"))
MAX_TIME_SEC = int(os.environ.get("H_AGENT_MAX_TIME_SEC", "300"))
TIMEOUT_SEC = int(os.environ.get("H_AGENT_TIMEOUT_SEC", str(MAX_TIME_SEC + 60)))
HEADLESS = os.environ.get("H_AGENT_HEADLESS", "1") != "0"

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_ANSWER = re.compile(r"Answer\s*:\s*(.*)")


def execute(config: dict, event: dict) -> dict:
    if MODE == "surfer_cli":
        return _run_surfer_cli(config)
    return _mock(config)


def _build_cmd(config: dict) -> list[str]:
    cmd = [
        SURFER_H_BIN,
        "--task", config["instructions"],
        "--url", config["url"],
        "--max_n_steps", str(MAX_STEPS),
        "--max_time_seconds", str(MAX_TIME_SEC),
        # navigation + localization both on the hosted Holo model
        "--base_url_navigation", MODEL_URL,
        "--model_name_navigation", MODEL_NAME,
        "--temperature_navigation", "0.0",
        "--base_url_localization", MODEL_URL,
        "--model_name_localization", MODEL_NAME,
        "--temperature_localization", "0.7",
    ]
    if HEADLESS:
        cmd.append("--headless-browser")
    return cmd


def _subprocess_env() -> dict:
    env = os.environ.copy()
    api_key = env.get("HAI_API_KEY", "")
    # surfer-h-cli reads per-skill keys; run-on-holo.sh sets both from HAI_API_KEY.
    env.setdefault("API_KEY_NAVIGATION", api_key)
    env.setdefault("API_KEY_LOCALIZATION", api_key)
    return env


def _run_once(config: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        _build_cmd(config),
        cwd=CLI_DIR,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SEC,
        env=_subprocess_env(),
    )


def _run_surfer_cli(config: dict) -> dict:
    if not os.environ.get("HAI_API_KEY"):
        raise RuntimeError("H_AGENT_MODE=surfer_cli but HAI_API_KEY is not set")
    if not os.path.exists(SURFER_H_BIN):
        raise RuntimeError(
            f"surfer-h-cli not installed at {SURFER_H_BIN}; run automation/setup_h_agent.sh"
        )

    started = time.time()
    proc = _run_once(config)
    if proc.returncode != 0:  # agent runs are flaky — retry once
        proc = _run_once(config)
        if proc.returncode != 0:
            raise RuntimeError(f"surfer-h failed twice; stderr tail: {proc.stderr[-500:]}")

    clean = _ANSI.sub("", proc.stdout)
    answers = _ANSWER.findall(clean)
    return {
        "backend": "surfer_cli",
        "task": config.get("task"),
        "url": config["url"],
        "duration_sec": round(time.time() - started, 1),
        "answer": answers[-1].strip() if answers else None,
        "trajectory_tail": "\n".join(clean.splitlines()[-40:]),
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
        "replay_url": None,
    }
