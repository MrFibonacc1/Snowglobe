"""HTTP detect API for the dashboard's Testing page.

Runs the VLM on a single uploaded image and returns per-event verdicts plus the
schema-valid events that would be emitted. The browser can't call NVIDIA
directly (the API key would leak), so it uploads here and this service makes
the model call server-side.

    uvicorn perception.server:app --port 8008
    # or:  python -m perception.server
"""
from __future__ import annotations

import base64
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
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
from .sampler import Frame, sample_frames

app = FastAPI(title="snowglobe perception detect API")
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

    return {"kind": "image", "model": model_tag, "mock": used_mock,
            "verdicts": verdicts, "events": emitted}


def _thumb(frame_img, width: int = 260) -> str:
    """Downscaled base64 JPEG data URL, so the dashboard can show each sampled
    frame without needing the snapshot server running."""
    h, w = frame_img.shape[:2]
    if w > width:
        frame_img = cv2.resize(frame_img, (width, max(1, int(h * width / w))))
    ok, buf = cv2.imencode(".jpg", frame_img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


@app.post("/detect_video")
async def detect_video(
    file: UploadFile = File(...),
    events: str = Form(",".join(EVENT_TYPES)),
    zone: str = Form("zone_a"),
    min_confidence: float = Form(0.5),
    fps: float = Form(0.5),
    max_frames: int = Form(6),
    mock: bool = Form(False),
):
    requested = [e.strip() for e in events.split(",") if e.strip() in EVENT_TYPES]
    if not requested:
        return JSONResponse(status_code=400, content={"error": "no valid event types"})

    # OpenCV needs a real file path, so buffer the upload to a temp file.
    raw = await file.read()
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(raw)
        tmp.close()
        max_frames = max(1, min(int(max_frames), 20))  # hard cap on model calls
        frames = list(
            sample_frames(
                tmp.name, fps=fps, snapshot_dir=_cfg.snapshot_dir,
                limit=max_frames, save=True,
            )
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"could not read video: {e}"})
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    if not frames:
        return JSONResponse(status_code=400, content={"error": "no frames decoded from video"})

    detector, used_mock = _detector(mock)
    model_tag = "mock" if used_mock else _cfg.model

    # Run every (frame, event_type) pair concurrently — otherwise a 6-frame clip
    # with 4 event types is 24 sequential ~1.2s calls (~30s). Capped workers keep
    # us under hosted rate limits.
    def run_pair(fr, et):
        return fr.seq, et, detector.detect(fr.image, et)

    verdict_map: dict[tuple[int, str], object] = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for fut in [ex.submit(run_pair, fr, et) for fr in frames for et in requested]:
            try:
                seq, et, v = fut.result()
                verdict_map[(seq, et)] = v
            except Exception:
                pass  # a failed call just leaves that (frame, event) missing

    frames_out = []
    for fr in frames:
        vs = []
        for et in requested:
            v = verdict_map.get((fr.seq, et))
            if v is not None:
                vs.append({"event_type": et, "detected": v.detected,
                           "confidence": round(v.confidence, 3),
                           "count": v.count, "detail": v.detail})
        frames_out.append({
            "index": fr.seq,
            "t_sec": round(fr.seq / fps, 1) if fps else fr.seq,
            "thumb": _thumb(fr.image),
            "verdicts": vs,
        })

    # Per event type: peak-confidence frame that cleared the threshold → one
    # representative event, so a clip yields a handful of events, not dozens.
    summary, events_out = [], []
    for et in requested:
        hits = [(fr, verdict_map[(fr.seq, et)]) for fr in frames if (fr.seq, et) in verdict_map]
        detected = [(fr, v) for fr, v in hits if v.detected and v.confidence >= min_confidence]
        peak = max(detected, key=lambda x: x[1].confidence, default=None)
        summary.append({
            "event_type": et,
            "fired": bool(detected),
            "frames_detected": len(detected),
            "frames_total": len(hits),
            "peak_confidence": round(peak[1].confidence, 3) if peak else 0.0,
            "count": peak[1].count if peak else None,
        })
        if peak:
            fr, v = peak
            events_out.append(
                emit_mod.build_event(et, v, zone, fr,
                                     snapshot_base_url=_cfg.snapshot_base_url, model=model_tag)
            )

    return {
        "kind": "video", "model": model_tag, "mock": used_mock,
        "fps": fps, "frames_analyzed": len(frames),
        "frames": frames_out, "summary": summary, "events": events_out,
    }


def main():
    import uvicorn

    port = int(os.getenv("PERCEPTION_PORT", "8008"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
