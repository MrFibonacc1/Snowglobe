"""Batch-run the discovery pipeline over every sample_data clip and print a
summary of what actionable events each one surfaces (VLM + grounding)."""
from __future__ import annotations

import glob
import os
import sys
import time

import cv2

from perception.config import Config
from perception import vlm as vlm_mod, grounding as g, fusion as f

FPS = 0.5          # sample one frame every 2s of video
MAX_FRAMES = 6     # cap model calls per clip
MIN_CONF = 0.5


def clip_frames(path, fps, max_frames):
    cap = cv2.VideoCapture(path)
    native = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    skip = max(1, round(native / fps))
    frames, idx, taken = [], 0, 0
    while taken < max_frames:
        ok, img = cap.read()
        if not ok:
            break
        if idx % skip == 0:
            frames.append((round(idx / native, 1), img))
            taken += 1
        idx += 1
    cap.release()
    return frames, total, native


def main():
    cfg = Config.from_env()
    det = vlm_mod.build_detector(cfg, mock=False)
    gd = g.GroundingDetector(cfg)
    print(f"discover_model={cfg.discover_model}  grounding={gd.enabled}\n")

    clips = sorted(glob.glob("sample_data/*.mp4"))
    for path in clips:
        name = os.path.basename(path)
        frames, total, native = clip_frames(path, FPS, MAX_FRAMES)
        t0 = time.perf_counter()
        # event_type -> (peak_conf, detail, grounded, frames_seen)
        peak: dict[str, list] = {}
        for t_sec, img in frames:
            try:
                findings = det.discover(img)
            except Exception as e:
                print(f"  ! discover failed on {name} @ {t_sec}s: {e}", file=sys.stderr)
                findings = []
            f.ground_verdicts(gd, img, findings)
            for v in findings:
                cur = peak.get(v.event_type)
                if cur is None or v.confidence > cur[0]:
                    peak[v.event_type] = [v.confidence, v.detail, v.grounded, 1]
                else:
                    cur[3] += 1
        dt = time.perf_counter() - t0
        fired = {k: val for k, val in peak.items() if val[0] >= MIN_CONF}
        print(f"── {name}  ({len(frames)} frames sampled, {dt:.1f}s)")
        if not fired:
            print("     (no actionable events)")
        for et, (conf, detail, grounded, seen) in sorted(
            fired.items(), key=lambda x: -x[1][0]
        ):
            gtag = {True: "grounded", False: "ungrounded", None: "-"}[grounded]
            print(f"     {et:24} conf={conf:.2f} x{seen} [{gtag}]  {detail or ''}")
        print()


if __name__ == "__main__":
    main()
