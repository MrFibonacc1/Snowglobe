"""Configuration for the perception service.

Values come from environment variables (optionally a local .env), and are
overridden by CLI flags in __main__.py. Nothing here is secret except the
API key, which is only ever read from the environment.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# OpenAI-compatible NIM endpoint. build.nvidia.com serves models at this base;
# a self-hosted NIM container exposes the same shape on its own host:port.
DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Cosmos 3 Reasoner (Nano) — the hosted default. Swap via VLM_MODEL / --model:
#   - Cosmos 3 Super's 32B reasoner if NVIDIA grants datacenter GPU access
#   - a Nemotron-VL / VILA model id as the rate-limit fallback
DEFAULT_MODEL = "nvidia/cosmos3-nano-reasoner"

DEFAULT_AUTOMATION_URL = "http://localhost:8000"
# Static host for saved frames; see snapshot_server.py. None → emit local paths.
DEFAULT_SNAPSHOT_BASE_URL = "http://localhost:8001"


@dataclass
class Config:
    api_key: str | None
    base_url: str
    model: str
    automation_url: str
    snapshot_base_url: str | None
    snapshot_dir: str
    request_timeout: float
    temperature: float
    max_tokens: int

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            api_key=os.getenv("NVIDIA_API_KEY"),
            base_url=os.getenv("VLM_BASE_URL", DEFAULT_BASE_URL),
            model=os.getenv("VLM_MODEL", DEFAULT_MODEL),
            automation_url=os.getenv("AUTOMATION_URL", DEFAULT_AUTOMATION_URL),
            snapshot_base_url=os.getenv("SNAPSHOT_BASE_URL", DEFAULT_SNAPSHOT_BASE_URL),
            snapshot_dir=os.getenv("SNAPSHOT_DIR", "snapshots"),
            request_timeout=float(os.getenv("VLM_TIMEOUT", "60")),
            temperature=float(os.getenv("VLM_TEMPERATURE", "0.1")),
            max_tokens=int(os.getenv("VLM_MAX_TOKENS", "512")),
        )
