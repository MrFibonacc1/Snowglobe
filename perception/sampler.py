"""Frame sampler: pull ~N fps from a webcam, RTSP stream, or video file, and
save each sampled frame to disk so it has a stable snapshot_url."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import cv2


@dataclass
class Frame:
    seq: int
    image: "any"  # numpy ndarray (BGR)
    timestamp: datetime
    path: str  # relative path on disk, e.g. "snapshots/frame_...jpg" ("" if unsaved)
    filename: str


def resolve_source(source: str):
    """'webcam' or a bare integer → camera index; anything else → URL / path.

    For plain `webcam`, prefer a non-default index first (typically 1 for a
    connected external/phone camera) and fall back to 0. This keeps behavior
    compatible with single-camera setups while allowing iPhone camera-first setups
    without requiring manual index entry.
    """
    if source == "webcam":
        for idx in (1, 0):
            cap = cv2.VideoCapture(idx)
            try:
                if cap.isOpened():
                    return idx
            finally:
                cap.release()
        return 0
    if source.isdigit():
        return int(source)
    return source


def _is_file(resolved) -> bool:
    return isinstance(resolved, str) and not resolved.lower().startswith(
        ("rtsp://", "http://", "https://")
    )


def _parse_screen(source: str):
    """Parse a screen-capture source spec, or None if `source` isn't one.

    'screen'           -> whole primary display
    'screen:X,Y,W,H'   -> a region (pixels), e.g. capture a Night Owl / QuickTime
                          live-view window and feed it to the pipeline when the
                          camera won't expose RTSP.
    """
    if source != "screen" and not source.startswith("screen:"):
        return None
    spec = source[len("screen"):].lstrip(":").strip()
    if not spec:
        return {}  # {} = primary monitor
    parts = spec.split(",")
    if len(parts) != 4:
        raise ValueError("screen source must be 'screen' or 'screen:X,Y,W,H'")
    x, y, w, h = (int(p.strip()) for p in parts)
    return {"left": x, "top": y, "width": w, "height": h}


class _ScreenCapture:
    """Minimal cv2.VideoCapture look-alike backed by mss screen grabs, so the
    sampler treats a screen region exactly like a live camera (BGR frames,
    wall-clock gating). Needs Screen Recording permission on macOS."""

    def __init__(self, region: dict):
        import mss  # lazy: optional dep, only for the screen source
        import numpy as np

        self._np = np
        self._sct = mss.mss()
        self._monitor = region or self._sct.monitors[1]  # [1] = primary display
        self._opened = True

    def isOpened(self) -> bool:
        return self._opened

    def read(self):
        try:
            shot = self._sct.grab(self._monitor)
        except Exception:  # noqa: BLE001 — treat a failed grab like a dropped frame
            return False, None
        bgr = cv2.cvtColor(self._np.asarray(shot), cv2.COLOR_BGRA2BGR)
        return True, bgr

    def get(self, _prop) -> float:
        return 0.0  # no native fps → sampler uses wall-clock gating

    def release(self) -> None:
        try:
            self._sct.close()
        except Exception:  # noqa: BLE001
            pass
        self._opened = False


def sample_frames(
    source: str,
    fps: float = 0.3,
    snapshot_dir: str = "snapshots",
    limit: int | None = None,
    max_seconds: float | None = None,
    save: bool = True,
    should_stop=None,
):
    """Yield Frame objects at approximately `fps`.

    For files with a known frame rate we skip frames deterministically (so a
    10 s clip yields ~3 frames at 0.3 fps regardless of playback speed). For live
    sources we gate on wall-clock time.

    `should_stop`, if given, is a zero-arg callable polled each iteration; when
    it returns True the generator stops cleanly (used to Pause a live camera).
    """
    screen_region = _parse_screen(source)
    if screen_region is not None:
        cap = _ScreenCapture(screen_region)
        resolved = None  # sentinel: live, non-file → wall-clock gating
    else:
        resolved = resolve_source(source)
        cap = cv2.VideoCapture(resolved)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video source: {source!r}")

    if save:
        os.makedirs(snapshot_dir, exist_ok=True)

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    frame_skip = None
    if _is_file(resolved) and native_fps > 0 and fps > 0:
        frame_skip = max(1, round(native_fps / fps))
    interval = 1.0 / fps if fps > 0 else 0.0

    seq = 0
    read_idx = 0
    start = time.monotonic()
    last_taken = 0.0
    try:
        while True:
            if should_stop is not None and should_stop():
                break
            ok, image = cap.read()
            if not ok:
                break  # end of file or dropped stream
            read_idx += 1

            if frame_skip is not None:
                take = (read_idx % frame_skip) == 0
            else:
                now = time.monotonic()
                take = (now - last_taken) >= interval
                if take:
                    last_taken = now

            if not take:
                if frame_skip is None:
                    time.sleep(0.005)  # be nice to the CPU on live sources
                continue

            ts = datetime.now(timezone.utc)
            filename = f"frame_{ts:%Y%m%dT%H%M%S}_{ts.microsecond // 1000:03d}_{seq:04d}.jpg"
            path = ""
            if save:
                path = os.path.join(snapshot_dir, filename)
                cv2.imwrite(path, image)

            yield Frame(seq, image, ts, path, filename)
            seq += 1

            if limit is not None and seq >= limit:
                break
            if max_seconds is not None and (time.monotonic() - start) >= max_seconds:
                break
    finally:
        cap.release()
