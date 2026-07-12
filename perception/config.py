"""Configuration for the perception service.

Values come from environment variables (optionally a local .env), and are
overridden by CLI flags in __main__.py. Nothing here is secret except the
API key, which is only ever read from the environment.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_ENV_LOADED = False


def _load_env() -> None:
    """Load perception/.env once, by absolute path, so it works no matter which
    directory the process was launched from (repo root, perception/, uvicorn)."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    _ENV_LOADED = True
    try:
        from dotenv import load_dotenv

        load_dotenv(Path(__file__).resolve().parent / ".env")
    except Exception:
        pass  # python-dotenv not installed — rely on real env vars

# OpenAI-compatible NIM endpoint. build.nvidia.com serves models at this base;
# a self-hosted NIM container exposes the same shape on its own host:port.
DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Default is a Nemotron-VL model that IS served on hosted inference
# (integrate.api.nvidia.com) and verified to read frames + return our JSON.
#   - Cosmos reasoner (Cosmos 3 Super / `nvidia/cosmos-reason2-8b`) is the
#     intended primary, but 404s on hosted inference for our account — it needs
#     a self-hosted NIM container / GPU access. Deploy the NIM on Baseten
#     (see deploy/baseten-cosmos3/) and point VLM_BASE_URL at the Baseten model
#     endpoint, VLM_API_KEY at your Baseten key, VLM_AUTH_SCHEME=api-key, and
#     VLM_MODEL at the served model id.
#   - `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` is a larger hosted
#     alternative (reasoning; emits <think> blocks we already strip).
DEFAULT_MODEL = "nvidia/nemotron-nano-12b-v2-vl"

# Two-tier detection: a stronger model does the open-ended DISCOVERY pass (the
# hard "what actionable events are here?" reasoning), while the fast/cheap
# DEFAULT_MODEL handles targeted per-frame yes/no verification. llama-3.2-90b is
# the strongest image reasoner verified callable on hosted inference right now.
# Set VLM_DISCOVER_MODEL="" (empty) to use VLM_MODEL for discovery too.
DEFAULT_DISCOVER_MODEL = "meta/llama-3.2-90b-vision-instruct"

DEFAULT_AUTOMATION_URL = "http://localhost:8000"
# Static host for saved frames; see snapshot_server.py. None → emit local paths.
DEFAULT_SNAPSHOT_BASE_URL = "http://localhost:8001"


@dataclass
class Config:
    api_key: str | None
    auth_scheme: str
    base_url: str
    model: str
    discover_model: str
    automation_url: str
    snapshot_base_url: str | None
    snapshot_dir: str
    request_timeout: float
    temperature: float
    max_tokens: int

    @classmethod
    def from_env(cls) -> "Config":
        _load_env()
        # VLM_API_KEY takes precedence so a self-hosted endpoint (e.g. a NIM
        # behind Baseten) can use its own key without touching NVIDIA_API_KEY.
        # auth_scheme selects the header: "bearer" (Authorization: Bearer, the
        # NVIDIA/OpenAI default) or "api-key" (Api-Key: ..., Baseten's scheme).
        model = os.getenv("VLM_MODEL", DEFAULT_MODEL)
        # Empty VLM_DISCOVER_MODEL → reuse the primary model for discovery too.
        discover_model = os.getenv("VLM_DISCOVER_MODEL", DEFAULT_DISCOVER_MODEL) or model
        return cls(
            api_key=os.getenv("VLM_API_KEY") or os.getenv("NVIDIA_API_KEY"),
            auth_scheme=os.getenv("VLM_AUTH_SCHEME", "bearer").strip().lower(),
            base_url=os.getenv("VLM_BASE_URL", DEFAULT_BASE_URL),
            model=model,
            discover_model=discover_model,
            automation_url=os.getenv("AUTOMATION_URL", DEFAULT_AUTOMATION_URL),
            snapshot_base_url=os.getenv("SNAPSHOT_BASE_URL", DEFAULT_SNAPSHOT_BASE_URL),
            snapshot_dir=os.getenv("SNAPSHOT_DIR", "snapshots"),
            request_timeout=float(os.getenv("VLM_TIMEOUT", "60")),
            temperature=float(os.getenv("VLM_TEMPERATURE", "0.1")),
            max_tokens=int(os.getenv("VLM_MAX_TOKENS", "512")),
        )
