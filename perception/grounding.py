"""Low-latency object grounding via NVIDIA's hosted Grounding DINO NIM.

The VLM discovery pass (a big model like llama-3.2-90b) is good at *reasoning*
about a scene — "this looks like a spill", "a forklift is close to a person" —
but it hallucinates and it's slow. Grounding DINO is an open-vocabulary object
detector: give it a comma-separated list of phrases ("spill, forklift, person")
and one frame, and it returns bounding boxes + a confidence per phrase in a few
hundred milliseconds.

We use it as a cheap, fast *second opinion* to confirm or deny each VLM finding:

  * VLM says "spill" → we ask DINO for "spill on floor, wet floor, liquid".
    If DINO puts a box on it, we're much more sure. If DINO sees nothing, we
    down-weight (or drop) the finding as a likely hallucination.

The hosted endpoint is OpenAI-message-shaped but NOT the chat-completions API:

    POST https://ai.api.nvidia.com/v1/cv/nvidia/nv-grounding-dino
    Authorization: Bearer <NVIDIA_API_KEY>
    { "model": "Grounding-Dino",
      "messages": [{"role":"user","content":[
        {"type":"text","text":"person, spill, forklift"},
        {"type":"media_url","media_url":{"url":"data:image/jpeg;base64,<...>"}}]}],
      "threshold": 0.3 }

For images under ~200 KB the call is synchronous (HTTP 200 with the result
inline); larger frames would require the async NVCF asset-upload dance, so we
downscale frames before encoding to stay on the fast synchronous path.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field

import cv2
import requests

from .vlm import encode_jpeg

# Inline base64 is only allowed for small payloads on the hosted endpoint; keep
# frames well under the ~200 KB limit so every call stays synchronous.
_MAX_INLINE_BYTES = 180_000


class GroundingUnavailable(Exception):
    """The grounding call could not complete (network, auth, 404 because the CV
    function isn't provisioned, etc.). Distinct from a successful call that
    simply found no objects — the former must not penalize a VLM finding."""


@dataclass
class Detection:
    """One grounded object: the phrase that matched, its best confidence, and
    every box for it (x, y, w, h in pixels)."""

    phrase: str
    confidence: float
    boxes: list[list[int]] = field(default_factory=list)


def _downscale_to_budget(frame_bgr, max_width: int = 960):
    """Shrink wide frames so the JPEG comfortably fits the inline base64 budget.
    Grounding DINO reports boxes in the *inferenced* frame's resolution, and we
    only ever use boxes qualitatively (presence/where), so downscaling is fine."""
    h, w = frame_bgr.shape[:2]
    if w > max_width:
        frame_bgr = cv2.resize(frame_bgr, (max_width, max(1, int(h * max_width / w))))
    return frame_bgr


def _encode_inline(frame_bgr) -> str:
    """JPEG-encode, downscaling / lowering quality until under the inline cap."""
    img = _downscale_to_budget(frame_bgr)
    for quality in (80, 65, 50, 35):
        data = encode_jpeg(img, quality)
        if len(data) <= _MAX_INLINE_BYTES:
            break
    return "data:image/jpeg;base64," + base64.b64encode(data).decode()


class GroundingDetector:
    """Client for the hosted Grounding DINO NIM. `enabled=False` (no key / turned
    off) makes every call a no-op returning [], so callers never need to branch."""

    def __init__(self, config):
        self.cfg = config
        self.enabled = bool(getattr(config, "grounding_enabled", False) and config.api_key)
        self.session = requests.Session()
        if self.enabled:
            self.session.headers.update(
                {
                    "Authorization": f"Bearer {config.api_key}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                }
            )

    def detect(self, frame_bgr, phrases: list[str]) -> list[Detection]:
        """Return one Detection per phrase that DINO localized in the frame.

        Never raises. On a transport/parse error it raises GroundingUnavailable
        so callers can tell "the detector is down" (don't penalize the finding)
        apart from "the detector ran and found nothing" (a real contradiction)."""
        if not self.enabled or not phrases:
            return []
        prompt = ", ".join(dict.fromkeys(p.strip() for p in phrases if p.strip()))
        if not prompt:
            return []
        body = {
            "model": "Grounding-Dino",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt[:1024]},
                        {"type": "media_url",
                         "media_url": {"url": _encode_inline(frame_bgr)}},
                    ],
                }
            ],
            "threshold": self.cfg.grounding_threshold,
        }
        try:
            resp = self.session.post(
                self.cfg.grounding_url,
                json=body,
                timeout=self.cfg.grounding_timeout,
            )
            resp.raise_for_status()
            return _parse(resp.json())
        except (requests.RequestException, ValueError, KeyError) as e:
            raise GroundingUnavailable(str(e)) from e


def _parse(data: dict) -> list[Detection]:
    """Flatten the nested Grounding DINO response into Detection objects.

    Shape: choices[].message.content.boundingBoxes[] where each box group has a
    `phrase`, a parallel `bboxes` list and a parallel `confidence` list."""
    out: list[Detection] = []
    for choice in data.get("choices", []) or []:
        content = (choice.get("message") or {}).get("content") or {}
        for bb in content.get("boundingBoxes", []) or []:
            phrase = str(bb.get("phrase", "")).strip()
            confs = bb.get("confidence") or []
            boxes = bb.get("bboxes") or []
            if not phrase or not confs:
                continue
            out.append(
                Detection(
                    phrase=phrase,
                    confidence=float(max(confs)),
                    boxes=[[int(x) for x in box] for box in boxes if len(box) == 4],
                )
            )
    return out
