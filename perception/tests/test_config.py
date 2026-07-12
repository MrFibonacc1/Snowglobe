import os
import unittest
from unittest.mock import patch

from perception.config import Config


class ConfigTests(unittest.TestCase):
    def test_grounding_is_always_local_yolo(self):
        with patch.dict(
            os.environ,
            {"GROUNDING_BACKEND": "none", "GROUNDING_ENABLED": "0"},
            clear=False,
        ):
            cfg = Config.from_env()

        self.assertEqual(cfg.grounding_backend, "yolo")
        self.assertTrue(cfg.grounding_enabled)


if __name__ == "__main__":
    unittest.main()
