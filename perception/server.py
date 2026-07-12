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
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import uuid4

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from . import emit as emit_mod
from . import fusion as fusion_mod
from . import gateway
from . import grounding as grounding_mod
from . import live as live_mod
from . import objects as objects_mod
from . import onvif as onvif_mod
from . import vlm as vlm_mod
from .capture import CameraRegistry
from .config import Config
from .sampler import Frame, sample_frames
from shared.event_normalization import is_supported_finding

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
_cameras = CameraRegistry(_cfg)


def _grounding_model_name():
    """Human label for the active grounding backend, only if it's live."""
    if not getattr(_grounder, "enabled", False):
        return None
    return getattr(_grounder, "model_name", None) or _grounding_kind


@app.on_event("shutdown")
def _shutdown_cameras():
    """Stop every capture worker cleanly when the app goes down, then release the
    go2rtc streams they were routed through so a restart doesn't orphan them."""
    # Snapshot state before shutdown clears the registry.
    routed = [c for c in _cameras.list() if c.get("gateway_stream")]
    _cameras.shutdown()
    for cam in routed:
        gateway.unregister(cam["gateway_stream"])  # best-effort; never raises


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
            if not is_supported_finding(v.event_type, v.grounded):
                continue
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
                if not is_supported_finding(v.event_type, v.grounded):
                    continue
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
                if not is_supported_finding(v.event_type, v.grounded):
                    continue
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


class CameraCreate(BaseModel):
    """Request body for POST /cameras. `source` accepts "webcam", an integer
    index string, an rtsp:// or http(s):// URL, or a file path."""

    name: str
    source: str
    zone: str
    # Sampling rate must be a positive, sane value: fps <= 0 would busy-spin the
    # worker / fire the VLM with no throttle; an absurd upper value would hammer
    # it. Out-of-range values return 422.
    fps: float = Field(default=0.3, gt=0, le=30)
    events: list[str] = []
    mock: bool = False
    automation_url: str | None = None  # optional override; defaults to Config
    # Tri-state routing control:
    #   True  → always front the source with go2rtc (falls back if it's down),
    #   False → never (direct sampling, the legacy path),
    #   None  → auto: route network URLs through go2rtc when it's reachable.
    use_gateway: bool | None = None


def _is_network_source(source: str) -> bool:
    """A source the sampler reaches over the network (vs a local webcam/file)."""
    return source.lower().startswith(("rtsp://", "http://", "https://", "onvif://"))


@app.post("/cameras", status_code=201)
def create_camera(body: CameraCreate):
    """Create and start a live-capture worker; returns its state object.

    When gateway routing applies, the worker samples the normalized go2rtc RTSP
    stream while the original request source is preserved as ``origin`` for
    display. Local devices (webcam / index / file) stay direct unless the caller
    explicitly opts in with ``use_gateway=True``.
    """
    # Route through go2rtc when explicitly requested, or (auto) for network URLs.
    # Local devices only route on an explicit opt-in.
    should_route = body.use_gateway is True or (
        body.use_gateway is None and _is_network_source(body.source)
    )

    sample_source = body.source
    origin = None
    stream_key = None
    # available() is only consulted when routing is on the table, so the direct
    # path stays untouched when go2rtc isn't in play. If routing was wanted but
    # go2rtc is unreachable — or the PUT itself fails — fall back to the direct
    # source (best-effort). The stream is keyed on a unique id, not the display
    # name, so two cameras with the same name don't collide/cross-delete.
    if should_route and gateway.available():
        candidate_key = f"{gateway.slug(body.name)}-{uuid4().hex[:6]}"
        normalized = gateway.register(candidate_key, body.source)
        if normalized is not None:
            sample_source = normalized
            origin = body.source
            stream_key = candidate_key

    # Store the stream key atomically with the camera's existence, so a DELETE
    # that lands right after create can always find and release the exact stream
    # (no window where the camera is visible but its stream key isn't recorded).
    state = _cameras.create(
        name=body.name,
        source=sample_source,
        zone=body.zone,
        fps=body.fps,
        events=body.events,
        mock=body.mock,
        automation_url=body.automation_url,
        origin=origin,
        gateway_stream=stream_key,
    )

    return state


@app.get("/cameras")
def list_cameras():
    return _cameras.list()


@app.get("/cameras/{cam_id}")
def get_camera(cam_id: str):
    state = _cameras.get(cam_id)
    if state is None:
        raise HTTPException(status_code=404, detail="unknown camera")
    return state


@app.post("/cameras/{cam_id}/pause")
def pause_camera(cam_id: str):
    state = _cameras.pause(cam_id)
    if state is None:
        raise HTTPException(status_code=404, detail="unknown camera")
    return state


@app.post("/cameras/{cam_id}/resume")
def resume_camera(cam_id: str):
    state = _cameras.resume(cam_id)
    if state is None:
        raise HTTPException(status_code=404, detail="unknown camera")
    return state


@app.delete("/cameras/{cam_id}", status_code=204)
def delete_camera(cam_id: str):
    # Read the camera's stream key BEFORE deleting; delete() drops the state.
    state = _cameras.get(cam_id)
    if state is None or not _cameras.delete(cam_id):
        raise HTTPException(status_code=404, detail="unknown camera")
    # Unregister the exact go2rtc stream this camera was routed through (its
    # unique stream key, not one derived from the display name, so we never
    # touch another camera's stream). Only routed cameras carry a key.
    stream_key = state.get("gateway_stream")
    if stream_key is not None:
        gateway.unregister(stream_key)  # best-effort; never raises
    return Response(status_code=204)


@app.get("/cameras/{cam_id}/latest.jpg")
def camera_latest(cam_id: str):
    if _cameras.get(cam_id) is None:
        raise HTTPException(status_code=404, detail="unknown camera")
    jpeg = _cameras.latest_jpeg(cam_id)
    if jpeg is None:
        raise HTTPException(status_code=404, detail="no frame sampled yet")
    return Response(content=jpeg, media_type="image/jpeg")


class ResolveRequest(BaseModel):
    """Request body for POST /discover/resolve."""

    xaddr: str
    username: str
    password: str
    profile_index: int = 0


@app.get("/discover")
def discover_cameras(timeout: float = Query(4.0, gt=0, le=15)):
    """WS-Discovery probe for ONVIF cameras on the LAN. Best-effort: missing
    ONVIF deps or an empty LAN both yield {"cameras": []} — never a 500.

    ``timeout`` is clamped to (0, 15] so an out-of-range value (e.g. ?timeout=inf)
    returns 422 instead of tying up a worker on an unbounded WS-Discovery wait."""
    try:
        cameras = onvif_mod.discover(timeout)
    except Exception as e:  # optional deps / probe failure — degrade to empty
        print(f"  ! /discover failed: {e}", file=sys.stderr)
        cameras = []
    return {"cameras": cameras}


@app.post("/discover/resolve")
def resolve_camera(body: ResolveRequest):
    """Resolve an ONVIF camera's RTSP URL (creds embedded) via GetStreamUri.
    Bad creds / unreachable host / missing ONVIF deps → 400 with a detail."""
    try:
        rtsp_url = onvif_mod.resolve_stream(
            body.xaddr, body.username, body.password, body.profile_index
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"could not resolve stream: {e}")
    return {"rtsp_url": rtsp_url}


def main():
    import uvicorn

    port = int(os.getenv("PERCEPTION_PORT", "8008"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
