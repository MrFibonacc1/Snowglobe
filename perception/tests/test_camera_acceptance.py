import time
import unittest
from pathlib import Path

from perception.capture import CameraRegistry
from perception.config import Config


class CameraAcceptanceTests(unittest.TestCase):
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
