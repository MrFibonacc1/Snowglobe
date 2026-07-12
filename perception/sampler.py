"""Frame sampler: pull ~N fps from a webcam, RTSP stream, or video file, and
save each sampled frame to disk so it has a stable snapshot_url."""
from __future__ import annotations

import os
import subprocess
import tempfile
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
    if w < 64 or h < 64:
        raise ValueError("screen region must be at least 64x64 pixels")
    return {"left": x, "top": y, "width": w, "height": h}


def _parse_window(source: str):
    """Parse ``window:App Name`` or ``window:App Name:X,Y,W,H``, or return None
    for another source type.

    The optional ``X,Y,W,H`` crops the captured window down to a sub-rectangle
    (pixels, in the captured window's own coordinate space — same space as a
    screenshot of that window) so chrome like Night Owl's top/bottom toolbars
    can be trimmed off, leaving just the video feed.
    """
    if not source.startswith("window:"):
        return None
    rest = source[len("window:"):].strip()
    app_name, _, crop_spec = rest.rpartition(":")
    if not app_name:
        app_name, crop_spec = crop_spec, ""
    if not app_name:
        raise ValueError("window source requires an app name")
    crop = None
    if crop_spec:
        parts = crop_spec.split(",")
        if len(parts) != 4:
            raise ValueError("window crop must be 'X,Y,W,H'")
        x, y, w, h = (int(p.strip()) for p in parts)
        if w < 64 or h < 64:
            raise ValueError("window crop must be at least 64x64 pixels")
        crop = (x, y, w, h)
    return app_name, crop


def open_source(source: str):
    """Open any supported source and return ``(capture, resolved)``.

    Keeping this factory shared makes screen capture work identically in the
    standalone sampler and the dashboard-managed camera workers.
    """
    parsed_window = _parse_window(source)
    if parsed_window is not None:
        app_name, crop = parsed_window
        return _WindowCapture(app_name, crop), None
    screen_region = _parse_screen(source)
    if screen_region is not None:
        return _ScreenCapture(screen_region), None
    resolved = resolve_source(source)
    return cv2.VideoCapture(resolved), resolved


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


class _WindowCapture:
    """cv2 capture adapter for one macOS application window.

    ``screencapture -l`` asks WindowServer for the window surface directly, so
    other apps can cover Night Owl without appearing in the captured frame.
    """

    _FIND_WINDOW_SWIFT = r'''
import CoreGraphics
let wanted = CommandLine.arguments.last ?? ""
let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as! [[String: Any]]
var best: (id: Int, area: Double)? = nil
for window in windows {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    guard owner.caseInsensitiveCompare(wanted) == .orderedSame,
          let number = window[kCGWindowNumber as String] as? Int,
          let bounds = window[kCGWindowBounds as String] as? [String: Any],
          let width = bounds["Width"] as? Double,
          let height = bounds["Height"] as? Double else { continue }
    let area = width * height
    if width >= 64, height >= 64, area > (best?.area ?? 0) { best = (number, area) }
}
if let best { print(best.id) }
'''

    def __init__(self, app_name: str, crop: tuple[int, int, int, int] | None = None):
        self._app_name = app_name
        self._crop = crop
        self._window_id = self._find_window_id()
        tmp = tempfile.NamedTemporaryFile(prefix="snowglobe-window-", suffix=".png", delete=False)
        self._path = tmp.name
        tmp.close()
        self._opened = self._window_id is not None

    def _find_window_id(self) -> int | None:
        try:
            result = subprocess.run(
                ["swift", "-e", self._FIND_WINDOW_SWIFT, self._app_name],
                capture_output=True, text=True, timeout=15, check=True,
            )
            return int(result.stdout.strip()) if result.stdout.strip() else None
        except (OSError, ValueError, subprocess.SubprocessError):
            return None

    def isOpened(self) -> bool:
        return self._opened

    def read(self):
        if not self._window_id:
            return False, None
        try:
            subprocess.run(
                ["screencapture", "-x", "-l", str(self._window_id), self._path],
                capture_output=True, timeout=10, check=True,
            )
            image = cv2.imread(self._path, cv2.IMREAD_UNCHANGED)
            if image is None:
                return False, None
            if image.ndim == 3 and image.shape[2] == 4:
                alpha = image[:, :, 3]
                points = cv2.findNonZero(alpha)
                if points is not None:
                    x, y, w, h = cv2.boundingRect(points)
                    image = image[y:y + h, x:x + w]
                image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
            if self._crop:
                x, y, w, h = self._crop
                image = image[y:y + h, x:x + w]
                if image.size == 0:
                    return False, None
            # Night Owl's Retina window surface is over 2K wide. The preview
            # and VLM do not benefit from that many pixels; bounding it avoids
            # repeated large JPEG encodes/transfers while preserving aspect.
            if image.shape[1] > 1280:
                height = max(1, round(image.shape[0] * 1280 / image.shape[1]))
                image = cv2.resize(image, (1280, height), interpolation=cv2.INTER_AREA)
            return True, image
        except (OSError, subprocess.SubprocessError):
            # Window ids change after an app restart; resolve it once more.
            self._window_id = self._find_window_id()
            return False, None

    def get(self, _prop) -> float:
        return 0.0

    def release(self) -> None:
        try:
            os.unlink(self._path)
        except OSError:
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
    cap, resolved = open_source(source)
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
