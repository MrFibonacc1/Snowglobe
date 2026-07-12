import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np

from perception.vlm import VLMDetector


class VLMTransitionTests(unittest.TestCase):
    def test_transition_uses_one_side_by_side_image_for_single_image_endpoints(self):
        detector = VLMDetector.__new__(VLMDetector)
        detector.cfg = SimpleNamespace(
            discover_model="test-model", temperature=0, max_tokens=100,
            base_url="http://example.test", request_timeout=1,
        )
        response = Mock()
        response.json.return_value = {"choices": [{"message": {"content": "[]"}}]}
        detector.session = Mock()
        detector.session.post.return_value = response
        detector._chat = Mock(return_value="[]")
        before = np.zeros((60, 80, 3), dtype=np.uint8)
        after = np.full((60, 80, 3), 255, dtype=np.uint8)

        detector.discover_transition(before, after)

        comparison = detector._chat.call_args.args[0]
        self.assertEqual(comparison.shape[0], 60)
        self.assertEqual(comparison.shape[1], 160)
        detector._chat.assert_called_once()


if __name__ == "__main__":
    unittest.main()
