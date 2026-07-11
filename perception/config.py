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

# Default is a Nemotron-VL model that IS served on hosted inference
# (integrate.api.nvidia.com) and verified to read frames + return our JSON.
#   - Cosmos physical-AI reasoner (`nvidia/cosmos-reason2-8b`) is the intended
#     primary, but 404s on hosted inference for our account — it needs a
#     self-hosted NIM container / GPU access. Point VLM_BASE_URL at that NIM
#     and set VLM_MODEL=nvidia/cosmos-reason2-8b once we have the GPUs.
#   - `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` is a larger hosted
#     alternative (reasoning; emits <think> blocks we already strip).
DEFAULT_MODEL = "nvidia/nemotron-nano-12b-v2-vl"

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
