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
    """'webcam' or a bare integer → camera index; anything else → URL / path."""
    if source == "webcam":
        return 0
    if source.isdigit():
        return int(source)
    return source


def _is_file(resolved) -> bool:
    return isinstance(resolved, str) and not resolved.lower().startswith(
        ("rtsp://", "http://", "https://")
    )


def sample_frames(
    source: str,
    fps: float = 1.0,
    snapshot_dir: str = "snapshots",
    limit: int | None = None,
    max_seconds: float | None = None,
    save: bool = True,
):
    """Yield Frame objects at approximately `fps`.

    For files with a known frame rate we skip frames deterministically (so a
    10 s clip yields ~10 frames at 1 fps regardless of playback speed). For live
    sources we gate on wall-clock time.
    """
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
