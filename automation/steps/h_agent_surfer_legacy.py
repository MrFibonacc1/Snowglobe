"""LEGACY — H's deprecated open-source surfer-h-cli backend.

Upstream (github.com/hcompai/surfer-h-cli) is deprecated and its hosted Holo
endpoint (api.hcompanyprod.fr) no longer resolves. H's supported path is now
the Agent API — see h_agent.py `agent_api` mode. This module is kept only for
teams that self-host Holo via vLLM and want the local Selenium agent.

Set up with automation/setup_h_agent.sh, then H_AGENT_MODE=surfer_cli.
Requires a working local Chrome/Selenium (see NOTES.md gotcha).
"""

import os
import re
import subprocess
import time

_DEFAULT_CLI_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "surfer-h-cli")
)
CLI_DIR = os.environ.get("SURFER_H_CLI_DIR", _DEFAULT_CLI_DIR)
SURFER_H_BIN = os.environ.get(
    "SURFER_H_BIN", os.path.join(CLI_DIR, ".venv", "bin", "surfer-h-cli")
)
MODEL_URL = os.environ.get("HAI_MODEL_URL", "http://localhost:8080/v1")  # self-hosted vLLM
MODEL_NAME = os.environ.get("HAI_MODEL_NAME", "Hcompany/Holo1-7B")
MAX_STEPS = int(os.environ.get("H_AGENT_MAX_STEPS", "30"))
MAX_TIME_SEC = int(os.environ.get("H_AGENT_MAX_TIME_SEC", "300"))
TIMEOUT_SEC = int(os.environ.get("H_AGENT_TIMEOUT_SEC", str(MAX_TIME_SEC + 60)))
HEADLESS = os.environ.get("H_AGENT_HEADLESS", "1") != "0"

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_ANSWER = re.compile(r"Answer\s*:\s*(.*)")


def _cmd(config: dict) -> list[str]:
    cmd = [
        SURFER_H_BIN,
        "--task", config["instructions"],
        "--url", config["url"],
        "--max_n_steps", str(MAX_STEPS),
        "--max_time_seconds", str(MAX_TIME_SEC),
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


def run(config: dict) -> dict:
    if not os.path.exists(SURFER_H_BIN):
        raise RuntimeError(f"surfer-h-cli not installed at {SURFER_H_BIN}; run setup_h_agent.sh")
    env = os.environ.copy()
    key = env.get("HAI_API_KEY", "EMPTY")
    env.setdefault("API_KEY_NAVIGATION", key)
    env.setdefault("API_KEY_LOCALIZATION", key)

    started = time.time()
    proc = subprocess.run(
        _cmd(config), cwd=CLI_DIR, capture_output=True, text=True,
        timeout=TIMEOUT_SEC, env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"surfer-h failed; stderr tail: {proc.stderr[-500:]}")
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
