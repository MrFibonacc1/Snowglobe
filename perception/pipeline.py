"""Wire sampler → detector → emitter together.

Two modes:

* DISCOVERY (default, `--events` empty): each sampled frame goes through one
  open-ended VLM pass that surfaces any actionable events and names them
  itself. Event types are not constrained to a fixed set.
* TARGETED (`--events a,b,c`): each listed type (arbitrary, caller-defined) gets
  its own yes/no VLM pass per frame. If `foot_traffic` is requested it is
  DERIVED from `person_count` over a sliding window rather than a per-frame
  call — that's what "traffic" means (throughput over time).
"""
from __future__ import annotations

import sys
from datetime import datetime

from . import emit as emit_mod
from . import sampler as sampler_mod
from . import vlm as vlm_mod


class TrafficAggregator:
    """Accumulates person counts and, once per window, emits one foot_traffic
    event carrying the peak/average over that window.

    The window is measured in *sampled frames*, not wall-clock time, so it
    behaves identically whether we're reading a live camera in real time or
    consuming a clip as fast as the disk allows. At the sampling rate `fps`,
    `window_sec` seconds of video is `round(window_sec * fps)` sampled frames.
    """

    def __init__(self, window_sec: float, fps: float):
        self.window_sec = window_sec
        self.samples_per_window = max(1, round(window_sec * max(fps, 1e-6)))
        self.counts: list[int] = []

    def add(self, count: int):
        self.counts.append(count)

    def due(self) -> bool:
        return len(self.counts) >= self.samples_per_window

    def flush(self) -> dict | None:
        if not self.counts:
            return None
        peak = max(self.counts)
        avg = round(sum(self.counts) / len(self.counts), 1)
        result = {"count": peak, "peak": peak, "avg": avg,
                  "samples": len(self.counts), "window_sec": self.window_sec}
        self.counts = []
        return result


def run(cfg, args) -> int:
    detector = vlm_mod.build_detector(cfg, mock=args.mock)
    emitter = emit_mod.Emitter(
        automation_url=None if args.dump else args.automation_url,
        dump_path=args.dump,
    )

    events = [e.strip() for e in args.events.split(",") if e.strip()]
    discovery = not events  # no explicit types → open-ended discovery
    per_frame = [e for e in events if e != "foot_traffic"]
    traffic = TrafficAggregator(args.traffic_window, args.fps) if "foot_traffic" in events else None
    # foot_traffic needs person counts to aggregate.
    if traffic and "person_count" not in per_frame:
        per_frame.append("person_count")

    model_tag = "mock" if args.mock else cfg.model
    sink = f"dump→{args.dump}" if args.dump else f"POST→{args.automation_url}/events"
    mode = "discover" if discovery else f"targeted={events}"
    print(
        f"perception: source={args.source} zone={args.zone} fps={args.fps} "
        f"mode={mode} model={model_tag}\n            {sink}",
        file=sys.stderr,
    )

    # Simple per-(event_type,zone) debounce; 0 disables (engine dedups too).
    last_emit: dict[str, datetime] = {}

    def cooled_down(kind: str, ts: datetime) -> bool:
        if args.cooldown <= 0:
            return True
        prev = last_emit.get(kind)
        if prev and (ts - prev).total_seconds() < args.cooldown:
            return False
        last_emit[kind] = ts
        return True

    n_frames = 0
    try:
        for frame in sampler_mod.sample_frames(
            source=args.source,
            fps=args.fps,
            snapshot_dir=cfg.snapshot_dir,
            limit=args.limit,
            max_seconds=args.max_seconds,
            save=not args.no_save,
        ):
            n_frames += 1

            if discovery:
                try:
                    findings = detector.discover(frame.image)
                except Exception as e:  # never let one bad call kill the loop
                    print(f"  ! discover() failed: {e}", file=sys.stderr)
                    findings = []
                for verdict in findings:
                    if verdict.confidence < args.min_confidence:
                        continue
                    if not cooled_down(verdict.event_type, frame.timestamp):
                        continue
                    event = emit_mod.build_event(
                        verdict.event_type, verdict, args.zone, frame,
                        snapshot_base_url=cfg.snapshot_base_url if not args.no_save else None,
                        model=model_tag,
                    )
                    emitter.emit(event)
                    _log_event(event, verdict)
                continue

            for event_type in per_frame:
                try:
                    verdict = detector.detect(frame.image, event_type)
                except Exception as e:  # never let one bad call kill the loop
                    print(f"  ! detect({event_type}) failed: {e}", file=sys.stderr)
                    continue

                if event_type == "person_count" and traffic:
                    traffic.add(verdict.count or 0)

                if verdict.detected and verdict.confidence >= args.min_confidence:
                    if not cooled_down(event_type, frame.timestamp):
                        continue
                    event = emit_mod.build_event(
                        event_type, verdict, args.zone, frame,
                        snapshot_base_url=cfg.snapshot_base_url if not args.no_save else None,
                        model=model_tag,
                    )
                    emitter.emit(event)
                    _log_event(event, verdict)

            if traffic and traffic.due():
                agg = traffic.flush()
                if agg and cooled_down("foot_traffic", frame.timestamp):
                    verdict = vlm_mod.Verdict("foot_traffic", True, 0.9, count=agg["count"])
                    event = emit_mod.build_event(
                        "foot_traffic", verdict, args.zone, frame,
                        snapshot_base_url=cfg.snapshot_base_url if not args.no_save else None,
                        model=model_tag,
                    )
                    event.setdefault("payload", {}).update(agg)
                    emitter.emit(event)
                    _log_event(event, verdict)
    except KeyboardInterrupt:
        print("\nperception: stopped", file=sys.stderr)
    finally:
        emitter.close()

    print(
        f"perception: {n_frames} frames sampled, {emitter.sent} events emitted"
        + (f", {emitter.failed} failed" if emitter.failed else ""),
        file=sys.stderr,
    )
    return 0


def _log_event(event, verdict):
    extra = ""
    if verdict.count is not None:
        extra = f" count={verdict.count}"
    elif verdict.detail:
        extra = f" · {verdict.detail}"
    print(
        f"  → {event['event_type']:16} {event['location']:8} "
        f"conf={event['confidence']:.2f}{extra}",
        file=sys.stderr,
    )
