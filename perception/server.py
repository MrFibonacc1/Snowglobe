"""HTTP detect API for the dashboard's Testing page.

Runs the VLM on a single uploaded image and returns per-event verdicts plus the
schema-valid events that would be emitted. The browser can't call NVIDIA
directly (the API key would leak), so it uploads here and this service makes
the model call server-side.

    uvicorn perception.server:app --port 8008
    # or:  python -m perception.server
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import emit as emit_mod
from . import vlm as vlm_mod
from .config import Config
from .prompts import EVENT_TYPES
from .sampler import Frame

app = FastAPI(title="palantirV2 perception detect API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_cfg = Config.from_env()
_detectors: dict[bool, object] = {}


def _detector(mock: bool):
    """Cache one detector per mode. Falls back to mock if no API key is set."""
    use_mock = mock or not _cfg.api_key
    if use_mock not in _detectors:
        _detectors[use_mock] = vlm_mod.build_detector(_cfg, mock=use_mock)
    return _detectors[use_mock], use_mock


@app.get("/health")
def health():
    return {"ok": True, "model": _cfg.model, "has_key": bool(_cfg.api_key)}


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    events: str = Form(",".join(EVENT_TYPES)),
    zone: str = Form("zone_a"),
    min_confidence: float = Form(0.5),
    mock: bool = Form(False),
):
    raw = await file.read()
    frame_img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if frame_img is None:
        return JSONResponse(status_code=400, content={"error": "could not decode image"})

    requested = [e.strip() for e in events.split(",") if e.strip() in EVENT_TYPES]
    if not requested:
        return JSONResponse(status_code=400, content={"error": "no valid event types"})

    detector, used_mock = _detector(mock)
    model_tag = "mock" if used_mock else _cfg.model

    # Persist the uploaded frame so emitted events have a resolvable snapshot_url.
    ts = datetime.now(timezone.utc)
    filename = f"upload_{ts:%Y%m%dT%H%M%S}_{ts.microsecond // 1000:03d}.jpg"
    os.makedirs(_cfg.snapshot_dir, exist_ok=True)
    path = os.path.join(_cfg.snapshot_dir, filename)
    cv2.imwrite(path, frame_img)
    frame = Frame(0, frame_img, ts, path, filename)

    verdicts, emitted = [], []
    for et in requested:
        t = time.perf_counter()
        try:
            v = detector.detect(frame_img, et)
        except Exception as e:  # surface the failure per-event, don't 500 the whole request
            verdicts.append({"event_type": et, "error": str(e)})
            continue
        elapsed_ms = round((time.perf_counter() - t) * 1000)
        verdicts.append(
            {
                "event_type": et,
                "detected": v.detected,
                "confidence": round(v.confidence, 3),
                "count": v.count,
                "detail": v.detail,
                "elapsed_ms": elapsed_ms,
            }
        )
        if v.detected and v.confidence >= min_confidence:
            emitted.append(
                emit_mod.build_event(
                    et, v, zone, frame,
                    snapshot_base_url=_cfg.snapshot_base_url, model=model_tag,
                )
            )

    return {"model": model_tag, "mock": used_mock, "verdicts": verdicts, "events": emitted}


def main():
    import uvicorn

    port = int(os.getenv("PERCEPTION_PORT", "8008"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
