"""Generate a synthetic test clip so the pipeline is runnable without a camera
or real footage. Draws a moving 'person' rectangle, and paints a blue 'spill'
blob on some frames.

    python -m perception.make_test_clip --out demo/synthetic.mp4

Real demo clips (actual spills, crowds, PPE) should be recorded by hand; this
is purely for wiring/acceptance tests.
"""
from __future__ import annotations

import argparse

import cv2
import numpy as np


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="perception.make_test_clip")
    p.add_argument("--out", default="demo/synthetic.mp4")
    p.add_argument("--seconds", type=int, default=10)
    p.add_argument("--fps", type=int, default=10)
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=360)
    args = p.parse_args(argv)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.out, fourcc, args.fps, (args.width, args.height))
    if not writer.isOpened():
        raise RuntimeError(f"Could not open VideoWriter for {args.out!r}")

    total = args.seconds * args.fps
    for i in range(total):
        # Floor-ish grey background.
        frame = np.full((args.height, args.width, 3), 90, dtype=np.uint8)

        # A couple of moving "people" (bright rectangles).
        for k in range(2):
            x = int((i * (6 + 3 * k) + k * 200) % (args.width - 40))
            cv2.rectangle(frame, (x, 180), (x + 34, 300), (230, 230, 230), -1)

        # A blue "spill" blob for the middle third of the clip.
        if total // 3 <= i < 2 * total // 3:
            cv2.ellipse(frame, (args.width // 2, 300), (70, 26), 0, 0, 360, (200, 120, 30), -1)

        cv2.putText(frame, f"frame {i}", (10, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        writer.write(frame)

    writer.release()
    print(f"wrote {total} frames → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
