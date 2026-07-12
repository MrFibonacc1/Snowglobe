"""CLI entrypoint:  python -m perception --source demo/spill.mp4 --zone zone_b --dump out.jsonl"""
from __future__ import annotations

import argparse

from .config import Config
from . import pipeline

# perception/.env is loaded by Config.from_env() (by absolute path, so it works
# from any working directory).


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        prog="perception",
        description="Video → NVIDIA VLM detections → schema-valid events.",
    )
    p.add_argument("--source", default="webcam",
                   help="'webcam', a camera index, an rtsp:// URL, a video file path, "
                        "or 'screen' / 'screen:X,Y,W,H' to capture a screen region")
    p.add_argument("--zone", default="zone_a", help="zone identifier stamped on events")
    p.add_argument("--events", default="",
                   help="comma-separated event types to watch for (targeted mode). "
                        "Types are arbitrary, caller-defined slugs, e.g. "
                        "'spill,blocked_exit'. Leave empty for open-ended "
                        "discovery, where the model names events itself.")
    p.add_argument("--fps", type=float, default=0.3,
                   help="frames sampled per second (default ~1 frame every 3s; "
                        "matches the Reasoner's per-call latency and the slow "
                        "timescale of the events we detect)")
    p.add_argument("--min-confidence", type=float, default=0.5,
                   help="drop detections below this confidence")
    p.add_argument("--cooldown", type=float, default=0.0,
                   help="min seconds between emits of the same event type (0 = off; engine dedups too)")
    p.add_argument("--traffic-window", type=float, default=30.0,
                   help="seconds per foot_traffic aggregation window (targeted mode with foot_traffic)")
    p.add_argument("--limit", type=int, default=None, help="stop after N sampled frames")
    p.add_argument("--max-seconds", type=float, default=None, help="stop after N seconds")
    p.add_argument("--dump", metavar="PATH", default=None,
                   help="append events as JSONL to PATH instead of POSTing")
    p.add_argument("--automation-url", default=None,
                   help="automation service base URL (default from env / http://localhost:8000)")
    p.add_argument("--snapshot-base-url", default=None,
                   help="static host for saved frames (default from env / http://localhost:8001)")
    p.add_argument("--no-save", action="store_true", help="do not write frames to disk")
    p.add_argument("--mock", action="store_true",
                   help="use the offline mock detector (no API key needed)")
    p.add_argument("--model", default=None, help="override the VLM model id")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    cfg = Config.from_env()
    if args.automation_url:
        cfg.automation_url = args.automation_url
    if args.snapshot_base_url is not None:
        cfg.snapshot_base_url = args.snapshot_base_url
    if args.model:
        cfg.model = args.model
    # Resolve the effective automation URL for the pipeline.
    args.automation_url = cfg.automation_url

    return pipeline.run(cfg, args)


if __name__ == "__main__":
    raise SystemExit(main())
