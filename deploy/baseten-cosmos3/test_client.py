#!/usr/bin/env python3
"""Smoke-test a deployed Cosmos reasoner NIM (on Baseten or any OpenAI-compatible
endpoint) with a single image.

Usage:
    export VLM_BASE_URL="https://model-<id>.api.baseten.co/environments/production/sync/v1"
    export VLM_API_KEY="<your baseten api key>"
    export VLM_AUTH_SCHEME="api-key"          # baseten; use "bearer" for NVIDIA
    export VLM_MODEL="nvidia/cosmos-reason1-7b"
    python deploy/baseten-cosmos3/test_client.py path/to/frame.jpg

Prints the model's raw answer. Exit code 0 on a 200 response.
"""
from __future__ import annotations

import base64
import os
import sys

import requests

BASE_URL = os.environ.get("VLM_BASE_URL", "").rstrip("/")
API_KEY = os.environ.get("VLM_API_KEY") or os.environ.get("NVIDIA_API_KEY", "")
SCHEME = os.environ.get("VLM_AUTH_SCHEME", "bearer").strip().lower()
MODEL = os.environ.get("VLM_MODEL", "nvidia/cosmos-reason1-7b")


def main() -> int:
    if not BASE_URL or not API_KEY:
        print("Set VLM_BASE_URL and VLM_API_KEY (or NVIDIA_API_KEY).", file=sys.stderr)
        return 2
    if len(sys.argv) < 2:
        print("Pass an image path: test_client.py frame.jpg", file=sys.stderr)
        return 2

    with open(sys.argv[1], "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    auth = f"Api-Key {API_KEY}" if SCHEME == "api-key" else f"Bearer {API_KEY}"
    body = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe any safety-relevant or "
                     "actionable events in this scene in one sentence."},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }
        ],
        "max_tokens": 256,
        "temperature": 0.1,
        "stream": False,
    }

    resp = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": auth, "Accept": "application/json"},
        json=body,
        timeout=120,
    )
    print(f"HTTP {resp.status_code}")
    resp.raise_for_status()
    print(resp.json()["choices"][0]["message"]["content"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
