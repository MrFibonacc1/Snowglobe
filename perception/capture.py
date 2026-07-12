"""Live camera control plane: start/stop buffered capture workers over HTTP.

Each camera runs two background threads:

* a READER that continuously drains the source with ``cap.read()`` and keeps
  ONLY the newest frame (plus a throttled JPEG preview). Draining the buffer is
  what keeps us off stale RTSP/OpenCV frames — the slow VLM never gets to hold
  the pipe open.
* an INFERENCE loop that, roughly every ``1/fps`` seconds, grabs the freshest
  buffered frame and runs the SAME detection path as the CLI pipeline
  (``vlm.build_detector`` → ``detector.discover``/``detect`` →
  ``emit.build_event`` → ``emit.Emitter``).

Live sources that fail to open or drop mid-stream reconnect with exponential
backoff; a finite file that hits EOF stops gracefully instead of looping.
"""
from __future__ import annotations

import os

# OpenCV reads this when it builds the FFMPEG capture backend, so forcing TCP
# for RTSP (more robust than the default UDP) just needs the env var set before
# the VideoCapture is opened. Don't clobber an operator-provided value.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import cv2

from . import emit as emit_mod
from . import vlm as vlm_mod
from .sampler import Frame, _is_file, resolve_source
from shared.event_normalization import is_supported_finding

# Detections below this confidence are dropped, matching the pipeline/detect
# defaults. Not part of the camera API surface — a sensible fixed floor.
MIN_CONFIDENCE = 0.5

# Reconnect backoff for live sources: 1s, 2s, 4s, … capped.
_BACKOFF_START = 1.0
_BACKOFF_CAP = 30.0

# Consecutive failed reads on a live source before we tear down and reconnect.
_READ_FAIL_LIMIT = 10

# Time-based staleness backstop: if no successful frame has arrived on a live
# source within this window, force a teardown+reconnect even if reads are
# blocking (not failing fast), so a wedged host heals in seconds not minutes.
_STALE_RECONNECT_SEC = 15.0

# How often the reader refreshes the in-memory JPEG preview (Hz). Kept well
# below the stream rate so encoding never becomes the reader's bottleneck.
_PREVIEW_HZ = 8.0

# Defensive floor on the sampling rate inside the worker. The API validates
# fps > 0, but clamping here guarantees the interval math stays positive (no
# busy-spin / unthrottled VLM calls) even if a bad value ever reaches us.
_MIN_FPS = 0.01


@dataclass
class CameraState:
    """Serializable snapshot of a camera, mutated concurrently by the worker
    threads and read by the HTTP handlers, so every access goes through a lock.

    ``status`` is one of ``connecting`` | ``live`` | ``paused`` | ``error``,
    plus ``offline`` for a finite file that has played out.
    """

    id: str
    name: str
    source: str
    zone: str
    fps: float = 0.3
    events: list[str] = field(default_factory=list)
    mock: bool = False
    # Original request source when `source` is a normalized gateway (go2rtc) URL;
    # None for directly-sampled cameras. Surfaced for display only — the worker
    # always samples `source`.
    origin: str | None = None
    # go2rtc stream key this camera was routed through, or None if sampled
    # directly. Stored with the camera's existence so delete/shutdown can
    # unregister the exact stream without a fragile side-map.
    gateway_stream: str | None = None
    status: str = "connecting"
    last_frame_at: datetime | None = None
    frames_sampled: int = 0
    events_emitted: int = 0
    error: str | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def set(self, **fields) -> None:
        with self._lock:
            for key, value in fields.items():
                setattr(self, key, value)

    def inc(self, **fields) -> None:
        with self._lock:
            for key, value in fields.items():
                setattr(self, key, getattr(self, key) + value)

    def to_dict(self) -> dict:
        with self._lock:
            last = self.last_frame_at
            return {
                "id": self.id,
                "name": self.name,
                "source": self.source,
                "origin": self.origin,
                "gateway_stream": self.gateway_stream,
                "zone": self.zone,
                "fps": self.fps,
                "events": list(self.events),
                "mock": self.mock,
                "status": self.status,
                "last_frame_at": last.isoformat().replace("+00:00", "Z") if last else None,
                "frames_sampled": self.frames_sampled,
                "events_emitted": self.events_emitted,
                "error": self.error,
            }


class CameraWorker:
    """Owns the reader + inference threads and the shared latest-frame buffer
    for one camera."""

    def __init__(self, state: CameraState, cfg, automation_url: str):
        self.state = state
        self.cfg = cfg
        self.automation_url = automation_url

        # Mirror the pipeline: fall back to the offline mock when no key is set,
        # so a camera still "runs" without credentials.
        self.use_mock = state.mock or not cfg.api_key
        self.events = list(state.events)
        self.discovery = not self.events
        self.model_tag = "mock" if self.use_mock else cfg.model
        self.discover_tag = "mock" if self.use_mock else cfg.discover_model

        self._stop = threading.Event()
        self._paused = threading.Event()
        # Connection status independent of pause, so resume() can restore it.
        self._conn_status = "connecting"

        self._frame_lock = threading.Lock()
        self._latest_frame: tuple = ()  # (image, timestamp) or ()
        self._latest_jpeg: bytes | None = None
        self._last_processed_ts: datetime | None = None

        self._reader = threading.Thread(
            target=self._run_reader, name=f"{state.id}-reader", daemon=True
        )
        self._infer = threading.Thread(
            target=self._run_inference, name=f"{state.id}-infer", daemon=True
        )

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        self._reader.start()
        self._infer.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._reader.join(timeout=timeout)
        self._infer.join(timeout=timeout)

    def pause(self) -> None:
        self._paused.set()
        self.state.set(status="paused")

    def resume(self) -> None:
        self._paused.clear()
        self.state.set(status=self._conn_status, error=None)

    def latest_jpeg(self) -> bytes | None:
        with self._frame_lock:
            return self._latest_jpeg

    # -- reader thread -----------------------------------------------------

    def _report(self, status: str, error: str | None = None) -> None:
        """Record connection status, but don't stomp a manual pause."""
        self._conn_status = status
        if not self._paused.is_set():
            self.state.set(status=status, error=error)

    def _open(self):
        resolved = resolve_source(self.state.source)
        # Re-assert TCP transport per open in case the process env changed.
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        cap = cv2.VideoCapture(resolved)
        # Bound the open/read waits where the build supports it, so a dead RTSP
        # host can't wedge the reader forever. Attributes are guarded because
        # older OpenCV builds lack them.
        for attr in ("CAP_PROP_OPEN_TIMEOUT_MSEC", "CAP_PROP_READ_TIMEOUT_MSEC"):
            prop = getattr(cv2, attr, None)
            if prop is not None:
                try:
                    cap.set(prop, 10000)
                except Exception:
                    pass
        return cap, resolved

    def _run_reader(self) -> None:
        is_file = _is_file(resolve_source(self.state.source))
        preview_interval = 1.0 / _PREVIEW_HZ
        backoff = _BACKOFF_START

        while not self._stop.is_set():
            self._report("connecting", None)
            cap, _ = self._open()
            if not cap.isOpened():
                cap.release()
                if is_file:
                    # A file that won't open won't heal on its own — stop.
                    self._report("error", f"could not open source: {self.state.source!r}")
                    return
                self._report("error", f"could not open source: {self.state.source!r}")
                if self._stop.wait(backoff):
                    return
                backoff = min(backoff * 2, _BACKOFF_CAP)
                continue

            backoff = _BACKOFF_START
            self._report("live", None)
            fails = 0
            last_preview = 0.0
            last_ok = time.monotonic()

            while not self._stop.is_set():
                ok, image = cap.read()

                # Time-based staleness backstop for live sources: a host that
                # blocks on reads or accepts them without delivering a fresh
                # frame may never trip the fail counter, so reconnect on wall
                # clock too. Files are exempt (EOF must stop, not reconnect).
                if not is_file and (time.monotonic() - last_ok) >= _STALE_RECONNECT_SEC:
                    break

                if not ok:
                    if is_file:
                        # Finite source played out — stop gracefully.
                        cap.release()
                        self._report("offline", None)
                        return
                    fails += 1
                    if fails >= _READ_FAIL_LIMIT:
                        break  # drop out to reconnect
                    if self._stop.wait(0.1):
                        cap.release()
                        return
                    continue

                fails = 0
                last_ok = time.monotonic()
                ts = datetime.now(timezone.utc)
                with self._frame_lock:
                    self._latest_frame = (image, ts)

                # Refresh the preview JPEG at a throttled rate; encoding every
                # frame at full stream rate would burn CPU for no benefit.
                now = time.monotonic()
                if now - last_preview >= preview_interval:
                    last_preview = now
                    try:
                        jpeg = vlm_mod.encode_jpeg(image)
                        with self._frame_lock:
                            self._latest_jpeg = jpeg
                    except Exception:
                        pass

            cap.release()
            if self._stop.is_set():
                return
            # Live stream dropped — reconnect with backoff.
            self._report("error", "stream read failed; reconnecting")
            if self._stop.wait(backoff):
                return
            backoff = min(backoff * 2, _BACKOFF_CAP)

    # -- inference thread --------------------------------------------------

    def _take_frame(self) -> Frame | None:
        """Grab the freshest buffered frame as an *unsaved* ``Frame``, or None
        if there's nothing new since the last sample. The frame is only written
        to disk later, and only if it actually produces an event."""
        with self._frame_lock:
            if not self._latest_frame:
                return None
            image, ts = self._latest_frame

        if ts == self._last_processed_ts:
            return None  # reader hasn't produced a newer frame yet
        self._last_processed_ts = ts

        # Defer the disk write: idle frames (no event) never touch disk, which
        # bounds snapshot growth to frames that are actually referenced by an
        # emitted event. Naming mirrors the sampler's.
        filename = f"cam_{ts:%Y%m%dT%H%M%S}_{ts.microsecond // 1000:03d}.jpg"
        return Frame(self.state.frames_sampled, image, ts, "", filename)

    def _persist_frame(self, frame: Frame) -> None:
        """Write the frame to disk once and set ``frame.path`` so its events get
        a resolvable snapshot_url. Called only when an event is being emitted."""
        if frame.path:
            return  # already persisted for this frame
        try:
            os.makedirs(self.cfg.snapshot_dir, exist_ok=True)
            path = os.path.join(self.cfg.snapshot_dir, frame.filename)
            cv2.imwrite(path, frame.image)
            frame.path = path
        except Exception:
            frame.path = ""  # non-fatal: emit with a null snapshot instead

    def _emit(self, emitter, event_type, verdict, frame: Frame, model: str) -> None:
        """Persist the frame (once) then build + emit one event for it."""
        self._persist_frame(frame)
        base_url = self.cfg.snapshot_base_url if frame.path else None
        event = emit_mod.build_event(
            event_type, verdict, self.state.zone, frame,
            snapshot_base_url=base_url, model=model,
        )
        if emitter.emit(event):
            self.state.inc(events_emitted=1)

    def _process(self, detector, emitter, frame: Frame) -> None:
        # Run detection FIRST; only frames that clear the confidence filter get
        # written to disk (inside _emit), so idle frames leave no snapshot.
        if self.discovery:
            try:
                findings = detector.discover(frame.image)
            except Exception as exc:  # never let one bad call kill the loop
                self.state.set(error=f"discover failed: {exc}")
                return
            if self._stop.is_set():
                return  # camera deleted mid-call — no post-stop side effects
            for verdict in findings:
                if not is_supported_finding(verdict.event_type, verdict.grounded):
                    continue
                if verdict.confidence < MIN_CONFIDENCE:
                    continue
                self._emit(emitter, verdict.event_type, verdict, frame, self.discover_tag)
            return

        for event_type in self.events:
            try:
                verdict = detector.detect(frame.image, event_type)
            except Exception:
                continue
            if self._stop.is_set():
                return  # camera deleted mid-call — no post-stop side effects
            if verdict.detected and verdict.confidence >= MIN_CONFIDENCE:
                self._emit(emitter, event_type, verdict, frame, self.model_tag)

    def _run_inference(self) -> None:
        detector = vlm_mod.build_detector(self.cfg, mock=self.use_mock)
        emitter = emit_mod.Emitter(automation_url=self.automation_url)
        # Clamp defensively so a non-positive fps can never yield a zero/negative
        # interval (which would busy-spin or fire the VLM with no throttle).
        fps = max(float(self.state.fps), _MIN_FPS)
        interval = 1.0 / fps
        try:
            while not self._stop.is_set():
                start = time.monotonic()
                if self._paused.is_set():
                    self._stop.wait(0.2)
                    continue

                frame = self._take_frame()
                if frame is not None:
                    self.state.inc(frames_sampled=1)
                    self.state.set(last_frame_at=frame.timestamp)
                    self._process(detector, emitter, frame)

                # Sleep the remainder of the sampling interval (interruptibly).
                remaining = interval - (time.monotonic() - start)
                if remaining > 0:
                    if self._stop.wait(remaining):
                        break
                elif interval == 0:
                    # No rate limit requested — yield briefly so we don't spin.
                    if self._stop.wait(0.01):
                        break
        finally:
            emitter.close()


class CameraRegistry:
    """Thread-safe registry of running cameras."""

    def __init__(self, cfg, automation_url: str | None = None):
        self._cfg = cfg
        self._automation_url = automation_url or cfg.automation_url
        self._lock = threading.Lock()
        self._workers: dict[str, CameraWorker] = {}

    def create(
        self,
        name: str,
        source: str,
        zone: str,
        fps: float = 0.3,
        events: list[str] | None = None,
        mock: bool = False,
        automation_url: str | None = None,
        origin: str | None = None,
        gateway_stream: str | None = None,
    ) -> dict:
        cam_id = "cam_" + uuid.uuid4().hex[:8]
        state = CameraState(
            id=cam_id, name=name, source=source, zone=zone,
            fps=fps, events=list(events or []), mock=mock, origin=origin,
            gateway_stream=gateway_stream,
        )
        worker = CameraWorker(state, self._cfg, automation_url or self._automation_url)
        with self._lock:
            self._workers[cam_id] = worker
        worker.start()
        return state.to_dict()

    def list(self) -> list[dict]:
        with self._lock:
            workers = list(self._workers.values())
        return [w.state.to_dict() for w in workers]

    def get(self, cam_id: str) -> dict | None:
        worker = self._get(cam_id)
        return worker.state.to_dict() if worker else None

    def pause(self, cam_id: str) -> dict | None:
        worker = self._get(cam_id)
        if not worker:
            return None
        worker.pause()
        return worker.state.to_dict()

    def resume(self, cam_id: str) -> dict | None:
        worker = self._get(cam_id)
        if not worker:
            return None
        worker.resume()
        return worker.state.to_dict()

    def latest_jpeg(self, cam_id: str) -> bytes | None:
        worker = self._get(cam_id)
        return worker.latest_jpeg() if worker else None

    def delete(self, cam_id: str) -> bool:
        with self._lock:
            worker = self._workers.pop(cam_id, None)
        if not worker:
            return False
        worker.stop()
        return True

    def shutdown(self) -> None:
        with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        for worker in workers:
            worker.stop()

    def _get(self, cam_id: str) -> CameraWorker | None:
        with self._lock:
            return self._workers.get(cam_id)
