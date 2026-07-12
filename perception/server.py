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
from . import fusion as fusion_mod
from . import grounding as grounding_mod
from . import live as live_mod
from . import objects as objects_mod
from . import vlm as vlm_mod
from .config import Config
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
# Object grounding backend. YOLO runs locally inside this service (the working
# path); DINO is the deprecated NVIDIA hosted detector kept as a fallback option.
if _cfg.grounding_backend == "yolo":
    _grounder = objects_mod.YoloDetector(_cfg)
    _grounding_kind = "yolo"
else:
    _grounder = grounding_mod.GroundingDetector(_cfg)
    _grounding_kind = "grounding-dino"
_live = live_mod.LiveManager(_cfg)


def _grounding_model_name():
    """Human label for the active grounding backend, only if it's live."""
    if not getattr(_grounder, "enabled", False):
        return None
    return getattr(_grounder, "model_name", None) or _grounding_kind


def _detector(mock: bool):
    """Cache one detector per mode. Falls back to mock if no API key is set."""
    use_mock = mock or not _cfg.api_key
    if use_mock not in _detectors:
        _detectors[use_mock] = vlm_mod.build_detector(_cfg, mock=use_mock)
    return _detectors[use_mock], use_mock


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": _cfg.model,
        "discover_model": _cfg.discover_model,
        "grounding": _grounder.enabled,
        "grounding_model": _grounding_model_name(),
        "has_key": bool(_cfg.api_key),
    }


# --- live cameras -----------------------------------------------------------
# Start/stop the full perception pipeline on a live source (webcam / rtsp:// /
# http(s)://). Each camera runs in a background worker thread and streams events
# to the automation service just like a clip would.

@app.post("/live/start")
def live_start(body: dict):
    camera_id = str(body.get("camera_id") or body.get("zone") or "cam")
    source = str(body.get("source") or body.get("url") or "webcam")
    zone = str(body.get("zone") or camera_id)
    fps = float(body.get("fps", 1.0) or 1.0)
    events = str(body.get("events", "") or "")
    min_confidence = float(body.get("min_confidence", 0.5) or 0.5)
    if not source:
        return JSONResponse(status_code=400, content={"error": "source is required"})
    status = _live.start(camera_id, source, zone, fps, events, min_confidence)
    return {"ok": True, "grounding": _grounder.enabled, "live": status}


@app.post("/live/stop")
def live_stop(body: dict):
    camera_id = str(body.get("camera_id") or body.get("zone") or "")
    if not camera_id:
        return JSONResponse(status_code=400, content={"error": "camera_id is required"})
    status = _live.stop_camera(camera_id)
    if status is None:
        return JSONResponse(status_code=404, content={"error": "camera not found"})
    return {"ok": True, "live": status}


@app.get("/live/status")
def live_status(camera_id: str | None = None):
    return {"grounding": _grounder.enabled, "cameras": _live.status(camera_id)}


@app.on_event("shutdown")
def _shutdown():
    _live.stop_all()


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    events: str = Form(""),
    zone: str = Form("zone_a"),
    min_confidence: float = Form(0.5),
    mock: bool = Form(False),
):
    raw = await file.read()
    frame_img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if frame_img is None:
        return JSONResponse(status_code=400, content={"error": "could not decode image"})

    # Empty `events` → open-ended discovery. Otherwise targeted on the given
    # (arbitrary, caller-defined) type slugs.
    requested = [e.strip() for e in events.split(",") if e.strip()]
    discovery = not requested

    detector, used_mock = _detector(mock)
    # Attribute events to the model that actually produced them: discovery runs
    # on discover_model, targeted verification on the primary model.
    model_tag = "mock" if used_mock else _cfg.model
    discover_tag = "mock" if used_mock else _cfg.discover_model

    # Persist the uploaded frame so emitted events have a resolvable snapshot_url.
    ts = datetime.now(timezone.utc)
    filename = f"upload_{ts:%Y%m%dT%H%M%S}_{ts.microsecond // 1000:03d}.jpg"
    os.makedirs(_cfg.snapshot_dir, exist_ok=True)
    path = os.path.join(_cfg.snapshot_dir, filename)
    cv2.imwrite(path, frame_img)
    frame = Frame(0, frame_img, ts, path, filename)

    verdicts, emitted = [], []

    if discovery:
        t = time.perf_counter()
        try:
            found = detector.discover(frame_img)
        except Exception as e:
            return JSONResponse(status_code=502, content={"error": f"discover failed: {e}"})
        # Confirm/deny with the fast object detector (no-op if grounding is off).
        fusion_mod.ground_verdicts(_grounder, frame_img, found)
        elapsed_ms = round((time.perf_counter() - t) * 1000)
        for v in found:
            verdicts.append(
                {
                    "event_type": v.event_type,
                    "detected": v.detected,
                    "confidence": round(v.confidence, 3),
                    "count": v.count,
                    "detail": v.detail,
                    "grounded": v.grounded,
                    "objects": v.objects,
                    "elapsed_ms": elapsed_ms,
                }
            )
            if v.confidence >= min_confidence:
                emitted.append(
                    emit_mod.build_event(
                        v.event_type, v, zone, frame,
                        snapshot_base_url=_cfg.snapshot_base_url, model=discover_tag,
                    )
                )
        return {"kind": "image", "model": discover_tag, "mock": used_mock,
                "grounding": any(v.get("grounded") is not None for v in verdicts),
                "grounding_model": _grounding_model_name(),
                "mode": "discover", "verdicts": verdicts, "events": emitted}

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

    return {"kind": "image", "model": model_tag, "mock": used_mock, "mode": "targeted",
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
    events: str = Form(""),
    zone: str = Form("zone_a"),
    min_confidence: float = Form(0.5),
    fps: float = Form(0.5),
    max_frames: int = Form(6),
    mock: bool = Form(False),
):
    # Empty `events` → open-ended discovery. Otherwise targeted on the given
    # (arbitrary, caller-defined) type slugs.
    requested = [e.strip() for e in events.split(",") if e.strip()]
    discovery = not requested

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
    discover_tag = "mock" if used_mock else _cfg.discover_model
    # The model that actually produces the emitted events depends on the mode.
    emit_tag = discover_tag if discovery else model_tag

    # Run every frame (and, in targeted mode, every event type) concurrently —
    # otherwise a 6-frame clip is many sequential ~1.2s calls. Capped workers
    # keep us under hosted rate limits.
    if discovery:
        def run_pair(fr, _et):
            found = detector.discover(fr.image)
            fusion_mod.ground_verdicts(_grounder, fr.image, found)
            return fr.seq, None, found
        jobs = [(fr, None) for fr in frames]
    else:
        def run_pair(fr, et):
            return fr.seq, et, detector.detect(fr.image, et)
        jobs = [(fr, et) for fr in frames for et in requested]

    # In discovery mode the model names types itself, so verdicts are collected
    # per frame as a list; in targeted mode we key by (frame, requested type).
    verdict_map: dict[tuple[int, str], object] = {}
    discovered: dict[int, list] = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for fut in [ex.submit(run_pair, fr, et) for fr, et in jobs]:
            try:
                seq, et, result = fut.result()
                if discovery:
                    discovered[seq] = result
                else:
                    verdict_map[(seq, et)] = result
            except Exception:
                pass  # a failed call just leaves that (frame, event) missing

    frames_out = []
    for fr in frames:
        vs = []
        if discovery:
            for v in discovered.get(fr.seq, []):
                vs.append({"event_type": v.event_type, "detected": v.detected,
                           "confidence": round(v.confidence, 3),
                           "count": v.count, "detail": v.detail,
                           "grounded": v.grounded, "objects": v.objects})
        else:
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
    # The set of types is whatever appeared (discovered or requested).
    if discovery:
        hits_by_type: dict[str, list] = {}
        for seq, vs in discovered.items():
            fr = next((f for f in frames if f.seq == seq), None)
            for v in vs:
                hits_by_type.setdefault(v.event_type, []).append((fr, v))
    else:
        hits_by_type = {
            et: [(fr, verdict_map[(fr.seq, et)]) for fr in frames if (fr.seq, et) in verdict_map]
            for et in requested
        }

    summary, events_out = [], []
    for et, hits in hits_by_type.items():
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
                                     snapshot_base_url=_cfg.snapshot_base_url, model=emit_tag)
            )

    grounded_any = discovery and any(
        v.grounded is not None for vs in discovered.values() for v in vs
    )
    return {
        "kind": "video", "model": emit_tag, "mock": used_mock,
        "grounding": grounded_any,
        "grounding_model": _grounding_model_name(),
        "mode": "discover" if discovery else "targeted",
        "fps": fps, "frames_analyzed": len(frames),
        "frames": frames_out, "summary": summary, "events": events_out,
    }


def main():
    import uvicorn

    port = int(os.getenv("PERCEPTION_PORT", "8008"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
