import asyncio
import io
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import UploadFile

from perception import server
from perception.objects import Detection
from perception.vlm import Verdict


class DetectObjectsTests(unittest.TestCase):
    def tearDown(self):
        server._detect_previous_frames.clear()

    def test_detect_returns_visible_objects_when_there_are_no_actionable_findings(self):
        class EmptyDiscoveryDetector:
            def discover(self, _frame):
                return []

        class ObjectDetector:
            enabled = True
            model_name = "test-yolo"

            def detect_all(self, _frame):
                return [Detection("person", 0.91, [[0.1, 0.2, 0.7, 0.95]])]

        ok, encoded = cv2.imencode(".jpg", np.zeros((80, 120, 3), dtype=np.uint8))
        self.assertTrue(ok)

        with patch.object(server, "_detector", return_value=(EmptyDiscoveryDetector(), False)):
            with patch.object(server, "_grounder", ObjectDetector()):
                payload = asyncio.run(
                    server.detect(
                        file=UploadFile(file=io.BytesIO(encoded.tobytes()), filename="frame.jpg"),
                        events="",
                        zone="test",
                        min_confidence=0.5,
                        mock=False,
                    )
                )

        self.assertEqual(payload["events"], [])
        self.assertEqual(payload["verdicts"], [])
        self.assertEqual(payload["objects"], [{
            "phrase": "person",
            "confidence": 0.91,
            "boxes": [[0.1, 0.2, 0.7, 0.95]],
        }])

    def test_detect_uses_adjacent_frames_for_item_removal_reasoning(self):
        previous = np.zeros((80, 120, 3), dtype=np.uint8)
        current = np.full((80, 120, 3), 255, dtype=np.uint8)
        server._detect_previous_frames["shelf"] = previous

        class TransitionDetector:
            def discover(self, _frame):
                raise AssertionError("single-frame discovery should not be used")

            def discover_transition(self, before, after):
                self.before = before
                self.after = after
                return [Verdict(
                    "item_removed_from_shelf", True, 0.9,
                    detail="person removes a bottle from the shelf",
                )]

        detector = TransitionDetector()

        class ObjectDetector:
            enabled = True
            model_name = "test-yolo"

            def detect_all(self, _frame):
                return [
                    Detection("person", 0.92, [[0.1, 0.1, 0.8, 0.9]]),
                    Detection("bottle", 0.85, [[0.4, 0.4, 0.6, 0.8]]),
                ]

        ok, encoded = cv2.imencode(".jpg", current)
        self.assertTrue(ok)
        with patch.object(server, "_detector", return_value=(detector, False)):
            with patch.object(server, "_grounder", ObjectDetector()):
                payload = asyncio.run(server.detect(
                    file=UploadFile(file=io.BytesIO(encoded.tobytes()), filename="frame.jpg"),
                    events="", zone="shelf", min_confidence=0.5, mock=False,
                ))

        self.assertTrue(np.array_equal(detector.before, previous))
        self.assertTrue(np.array_equal(detector.after, current))
        self.assertEqual(payload["events"][0]["event_type"], "item_removed_from_shelf")


if __name__ == "__main__":
    unittest.main()
