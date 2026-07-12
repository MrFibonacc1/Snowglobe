import unittest

import numpy as np

from perception.fusion import frame_motion_score
from shared.event_normalization import is_supported_finding


class MotionTests(unittest.TestCase):
    def test_stationary_frame_has_no_motion_and_large_change_does(self):
        still = np.zeros((120, 160, 3), dtype=np.uint8)
        changed = still.copy()
        changed[:, 80:] = 255

        self.assertEqual(frame_motion_score(still, still), 0.0)
        self.assertGreater(frame_motion_score(still, changed), 0.4)

    def test_pickup_requires_motion_and_yolo_grounding(self):
        bottle = [{"phrase": "bottle", "confidence": 0.8, "boxes": [[0, 0, 1, 1]]}]
        person = [{"phrase": "person", "confidence": 0.9, "boxes": [[0, 0, 1, 1]]}]

        self.assertFalse(is_supported_finding(
            "item_pickup", True, 0.0, bottle, "person picks up a can",
        ))
        self.assertTrue(is_supported_finding(
            "item_pickup", True, 0.2, person, "person picks up a can",
        ))
        self.assertTrue(is_supported_finding(
            "item_pickup", True, 0.2, bottle, "person picks up a can",
        ))


if __name__ == "__main__":
    unittest.main()
