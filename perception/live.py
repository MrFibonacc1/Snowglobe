"""Live camera manager: run the perception pipeline on live sources in the
background, one worker thread per camera, controllable over HTTP.

A "live" source is anything OpenCV can open continuously — a webcam index, an
`rtsp://` stream, or an `http(s)://` MJPEG/HLS feed. The existing pipeline
already samples such sources on wall-clock time and runs the full discovery →
grounding → emit path; this module just wraps `pipeline.run` in a thread with a
stop flag so the dashboard can Start/Pause a camera without spawning processes.

The pipeline emits events to the automation service exactly as the CLI does, so
live footage flows into the same workflows and dashboard feed as clips.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import SimpleNamespace

from . import pipeline


@dataclass
class _Worker:
    camera_id: str
    zone: str
    source: str
    fps: float
    events: str
    thread: threading.Thread
    stop: threading.Event
    started_at: str
    error: str | None = None

    def status(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "zone": self.zone,
            "source": self.source,
            "fps": self.fps,
            "mode": "discover" if not self.events.strip() else "targeted",
            "running": self.thread.is_alive() and not self.stop.is_set(),
            "started_at": self.started_at,
            "error": self.error,
        }


class LiveManager:
    """Owns the set of running live camera workers. Thread-safe."""

    def __init__(self, cfg):
        self.cfg = cfg
        self._workers: dict[str, _Worker] = {}
        self._lock = threading.Lock()

    def start(self, camera_id: str, source: str, zone: str,
              fps: float = 1.0, events: str = "", min_confidence: float = 0.5) -> dict:
        with self._lock:
            existing = self._workers.get(camera_id)
            if existing and existing.thread.is_alive() and not existing.stop.is_set():
                return existing.status()  # already live — idempotent

            stop = threading.Event()
            # Reuse the CLI's arg shape; pipeline.run reads attributes off it.
            args = SimpleNamespace(
                source=source,
                zone=zone,
                events=events,
                fps=fps,
                min_confidence=min_confidence,
                cooldown=self.cfg_cooldown(),
                traffic_window=30.0,
                limit=None,
                max_seconds=None,
                dump=None,
                automation_url=self.cfg.automation_url,
                no_save=False,
                mock=not self.cfg.api_key,
                should_stop=stop.is_set,
            )
            worker = _Worker(
                camera_id=camera_id, zone=zone, source=source, fps=fps,
                events=events, thread=None, stop=stop,  # type: ignore[arg-type]
                started_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            )

            def _run():
                try:
                    pipeline.run(self.cfg, args)
                except Exception as e:  # surface, don't crash the server
                    worker.error = str(e)

            worker.thread = threading.Thread(
                target=_run, name=f"live-{camera_id}", daemon=True
            )
            self._workers[camera_id] = worker
            worker.thread.start()
            return worker.status()

    def cfg_cooldown(self) -> float:
        # Live feeds fire continuously; a short cooldown keeps the same standing
        # condition (a spill that stays on the floor) from spamming the feed.
        return 20.0

    def stop_camera(self, camera_id: str) -> dict | None:
        with self._lock:
            worker = self._workers.get(camera_id)
            if not worker:
                return None
            worker.stop.set()
            return worker.status()

    def status(self, camera_id: str | None = None):
        with self._lock:
            if camera_id is not None:
                w = self._workers.get(camera_id)
                return w.status() if w else None
            return [w.status() for w in self._workers.values()]

    def stop_all(self) -> None:
        with self._lock:
            for w in self._workers.values():
                w.stop.set()
