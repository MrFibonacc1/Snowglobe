import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np

from perception.capture import CameraRegistry, CameraState, CameraWorker
from perception.config import Config
from perception.sampler import Frame, _parse_screen, _parse_window
from perception.vlm import Verdict


class CameraAcceptanceTests(unittest.TestCase):
    def test_live_discovery_runs_yolo_before_applying_strict_gate(self):
        cfg = Config.from_env()
        state = CameraState("cam_test", "test", "screen", "shelf", fps=1)
        worker = CameraWorker(state, cfg, "http://127.0.0.1:9")
        previous = np.zeros((80, 120, 3), dtype=np.uint8)
        current = np.full((80, 120, 3), 255, dtype=np.uint8)
        worker._previous_analysis_image = previous

        class Detector:
            def discover(self, frame):
                return [Verdict(
                    "item_pickup", True, 0.9,
                    detail="person picks up a can",
                )]

        class Emitter:
            def emit(self, event):
                return True

        def ground(_grounder, _frame, verdicts):
            verdicts[0].grounded = True
            verdicts[0].objects = [{
                "phrase": "bottle", "confidence": 0.8,
                "boxes": [[0, 0, 1, 1]],
            }]

        frame = Frame(1, current, datetime.now(timezone.utc), "", "test.jpg")
        with patch("perception.capture.fusion_mod.ground_verdicts", side_effect=ground) as grounding:
            with patch.object(worker, "_emit") as emit:
                worker._process(Detector(), Emitter(), frame)

        grounding.assert_called_once()
        emit.assert_called_once()

    def test_screen_source_spec_is_accepted_and_validated(self):
        self.assertEqual(_parse_screen("screen"), {})
        self.assertEqual(
            _parse_screen("screen:100,200,1280,720"),
            {"left": 100, "top": 200, "width": 1280, "height": 720},
        )
        with self.assertRaises(ValueError):
            _parse_screen("screen:0,0,0,720")
        with self.assertRaisesRegex(ValueError, "at least 64x64"):
            _parse_screen("screen:2,3,4,5")

    def test_registry_rejects_an_invalid_screen_region_before_starting_worker(self):
        registry = CameraRegistry(Config.from_env(), automation_url="http://127.0.0.1:9")
        with self.assertRaisesRegex(ValueError, "at least 64x64"):
            registry.create(
                name="invalid screen", source="screen:2,3,4,5", zone="test", mock=True,
            )
        self.assertEqual(registry.list(), [])

    def test_window_source_requires_and_returns_an_app_name(self):
        self.assertEqual(
            _parse_window("window:Night Owl Protect CMS"),
            ("Night Owl Protect CMS", None),
        )
        self.assertIsNone(_parse_window("screen"))
        with self.assertRaisesRegex(ValueError, "app name"):
            _parse_window("window:")

    def test_window_source_accepts_an_optional_crop_rect(self):
        self.assertEqual(
            _parse_window("window:Night Owl Protect CMS:0,80,1280,600"),
            ("Night Owl Protect CMS", (0, 80, 1280, 600)),
        )
        with self.assertRaisesRegex(ValueError, "at least 64x64"):
            _parse_window("window:Night Owl Protect CMS:0,0,10,10")

    def test_real_sample_video_reaches_capture_buffer(self):
        root = Path(__file__).resolve().parents[2]
        clip = root / "sample_data" / "19_merl_shelf_interaction_1_1.mp4"
        self.assertTrue(clip.exists())
        registry = CameraRegistry(Config.from_env(), automation_url="http://127.0.0.1:9")
        state = registry.create(
            name="acceptance clip", source=str(clip), zone="front_shelf",
            fps=1, events=["item_removed_from_shelf"], mock=True,
        )
        try:
            deadline = time.time() + 8
            jpeg = None
            sampled = 0
            while time.time() < deadline and (jpeg is None or sampled == 0):
                jpeg = registry.latest_jpeg(state["id"])
                sampled = registry.get(state["id"])["frames_sampled"]
                time.sleep(0.05)
            self.assertIsNotNone(jpeg)
            self.assertTrue(jpeg.startswith(b"\xff\xd8"))
            self.assertGreater(sampled, 0)
        finally:
            registry.shutdown()


if __name__ == "__main__":
    unittest.main()
