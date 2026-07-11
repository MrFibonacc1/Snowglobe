"""Detectors: turn a frame + event type into a Verdict.

VLMDetector calls the Cosmos 3 Reasoner (or any OpenAI-compatible NIM model)
over HTTP. MockDetector produces deterministic verdicts from frame content so
the whole pipeline runs offline with no API key.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass

import cv2
import requests

from . import prompts


@dataclass
class Verdict:
    event_type: str
    detected: bool
    confidence: float
    count: int | None = None
    detail: str | None = None
    raw: str = ""

    def payload(self) -> dict:
        p: dict = {}
        if self.count is not None:
            p["count"] = self.count
        if self.detail:
            p["detail"] = self.detail
        return p


def encode_jpeg(frame_bgr, quality: int = 85) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("cv2.imencode failed to encode frame as JPEG")
    return buf.tobytes()


def strip_reasoning(text: str) -> str:
    """Reasoning models (Cosmos Reasoner, Nemotron-Reason) wrap their chain of
    thought in <think>...</think>. Drop it before hunting for the JSON."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)


def extract_json(text: str) -> dict | None:
    """Pull the first balanced {...} object out of a model response, tolerating
    reasoning blocks, markdown fences, and trailing prose."""
    if not text:
        return None
    text = strip_reasoning(text)
    text = text.replace("```json", "").replace("```", "")
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            c = text[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break  # malformed; try the next '{'
        start = text.find("{", start + 1)
    return None


def _verdict_from_json(event_type: str, data: dict | None, raw: str) -> Verdict:
    data = data or {}
    detected = bool(data.get("detected", False))
    try:
        conf = float(data.get("confidence", 0.0) or 0.0)
    except (TypeError, ValueError):
        conf = 0.0
    conf = max(0.0, min(1.0, conf))
    count = data.get("count")
    count = int(count) if isinstance(count, (int, float)) and not isinstance(count, bool) else None
    detail = data.get("detail")
    detail = str(detail) if detail else None
    return Verdict(event_type, detected, conf, count, detail, raw=raw)


class VLMDetector:
    """Calls an OpenAI-compatible NIM chat-completions endpoint with an image."""

    def __init__(self, config):
        if not config.api_key:
            raise RuntimeError(
                "NVIDIA_API_KEY is not set. Export it, or run with --mock for "
                "offline development."
            )
        self.cfg = config
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.api_key}",
                "Accept": "application/json",
            }
        )

    def detect(self, frame_bgr, event_type: str) -> Verdict:
        b64 = base64.b64encode(encode_jpeg(frame_bgr)).decode()
        body = {
            "model": self.cfg.model,
            "messages": [
                {"role": "system", "content": prompts.SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompts.for_event(event_type)},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                    ],
                },
            ],
            "temperature": self.cfg.temperature,
            "max_tokens": self.cfg.max_tokens,
            "stream": False,
        }
        resp = self.session.post(
            f"{self.cfg.base_url.rstrip('/')}/chat/completions",
            json=body,
            timeout=self.cfg.request_timeout,
        )
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
        if isinstance(text, list):  # some servers return content parts
            text = "".join(part.get("text", "") for part in text)
        return _verdict_from_json(event_type, extract_json(text), raw=text)


class MockDetector:
    """Deterministic, offline stand-in. Derives plausible verdicts from a hash
    of the frame so the same frame always yields the same answer, and the event
    stream stays lively without an API key."""

    def detect(self, frame_bgr, event_type: str) -> Verdict:
        h = int(hashlib.md5(encode_jpeg(frame_bgr, 40)).hexdigest(), 16)

        if event_type == "person_count":
            count = h % 12
            return Verdict(event_type, count > 0, 0.70 + (h % 25) / 100, count=count)
        if event_type == "foot_traffic":
            count = h % 30
            return Verdict(event_type, count > 0, 0.68 + (h % 20) / 100, count=count)
        if event_type == "spill":
            detected = (h % 5) == 0
            return Verdict(
                event_type,
                detected,
                0.82 + (h % 13) / 100 if detected else 0.10 + (h % 20) / 100,
                detail="Liquid pooled on the floor" if detected else None,
            )
        if event_type == "safety_violation":
            detected = (h % 7) == 0
            return Verdict(
                event_type,
                detected,
                0.78 + (h % 15) / 100 if detected else 0.12 + (h % 18) / 100,
                detail="Worker without hard hat" if detected else None,
            )
        return Verdict(event_type, False, 0.0)


def build_detector(config, mock: bool):
    return MockDetector() if mock else VLMDetector(config)
