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


def _slugify_type(value) -> str:
    """Normalize a model-chosen event type into a stable snake_case slug."""
    s = re.sub(r"[^a-z0-9]+", "_", str(value or "event").strip().lower())
    return s.strip("_") or "event"


def _verdicts_from_discovery(data, raw: str) -> list[Verdict]:
    """Parse the discovery pass output (a JSON array of findings) into Verdicts.

    The model chooses each finding's event_type slug; we normalize it but never
    constrain it to a fixed set."""
    findings = data if isinstance(data, list) else data.get("findings") if isinstance(data, dict) else None
    if not isinstance(findings, list):
        return []
    verdicts: list[Verdict] = []
    for item in findings:
        if not isinstance(item, dict):
            continue
        event_type = _slugify_type(item.get("event_type") or item.get("type"))
        v = _verdict_from_json(event_type, item, raw=raw)
        # Discovery findings are, by definition, detected.
        v.detected = True
        verdicts.append(v)
    return verdicts


def extract_json_array(text: str) -> list | None:
    """Pull the first balanced [...] array out of a model response."""
    if not text:
        return None
    text = strip_reasoning(text).replace("```json", "").replace("```", "")
    start = text.find("[")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            c = text[i]
            if c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("[", start + 1)
    return None


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

    def _chat(self, frame_bgr, prompt_text: str) -> str:
        b64 = base64.b64encode(encode_jpeg(frame_bgr)).decode()
        body = {
            "model": self.cfg.model,
            "messages": [
                {"role": "system", "content": prompts.SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
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
        return text

    def discover(self, frame_bgr) -> list[Verdict]:
        """Open-ended pass: the model names any actionable events it sees."""
        text = self._chat(frame_bgr, prompts.discover())
        return _verdicts_from_discovery(extract_json_array(text), raw=text)

    def detect(self, frame_bgr, event_type: str) -> Verdict:
        """Targeted pass: yes/no for one caller-defined event type."""
        text = self._chat(frame_bgr, prompts.for_event(event_type))
        return _verdict_from_json(event_type, extract_json(text), raw=text)


class MockDetector:
    """Deterministic, offline stand-in. Derives plausible verdicts from a hash
    of the frame so the same frame always yields the same answer, and the event
    stream stays lively without an API key."""

    # A pool of actionable, semantic event types the mock can "discover". This
    # is only sample variety for offline dev — the real model is not limited to
    # these, and neither is the rest of the system.
    _DISCOVERABLE = [
        ("spill", "Liquid pooled on the floor"),
        ("person_count", None),
        ("overcrowding", "Area is over its comfortable capacity"),
        ("blocked_exit", "Emergency exit is partially obstructed"),
        ("missing_ppe", "Worker without a hard hat"),
        ("unattended_item", "A bag left unattended near the aisle"),
        ("long_queue", "Checkout queue is unusually long"),
        ("slip_hazard", "Wet floor with no warning sign"),
    ]

    def discover(self, frame_bgr) -> list[Verdict]:
        h = int(hashlib.md5(encode_jpeg(frame_bgr, 40)).hexdigest(), 16)
        verdicts: list[Verdict] = []
        # Surface 0-2 findings depending on the frame, from the sample pool.
        n = h % 3
        for k in range(n):
            event_type, detail = self._DISCOVERABLE[(h >> (k * 5)) % len(self._DISCOVERABLE)]
            count = (h >> (k * 3)) % 20 if event_type in ("person_count", "overcrowding", "long_queue") else None
            conf = 0.70 + ((h >> k) % 28) / 100
            verdicts.append(Verdict(event_type, True, min(conf, 0.99), count=count, detail=detail))
        return verdicts

    def detect(self, frame_bgr, event_type: str) -> Verdict:
        h = int(hashlib.md5(encode_jpeg(frame_bgr, 40)).hexdigest(), 16)

        # Count-like concerns report a number; everything else is a yes/no with
        # a chance of firing, so any arbitrary user-defined type still works.
        if any(w in event_type for w in ("count", "traffic", "queue", "crowd", "occupancy")):
            count = h % 20
            return Verdict(event_type, count > 0, 0.68 + (h % 25) / 100, count=count)

        detected = (h % 5) == 0
        detail = event_type.replace("_", " ").capitalize() + " observed" if detected else None
        conf = 0.80 + (h % 15) / 100 if detected else 0.10 + (h % 20) / 100
        return Verdict(event_type, detected, conf, detail=detail)


def build_detector(config, mock: bool):
    return MockDetector() if mock else VLMDetector(config)
