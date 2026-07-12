import os
import sys
import tempfile
import unittest
from unittest.mock import patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

import storage


class PersistentCooldownTests(unittest.TestCase):
    def test_claim_survives_process_memory_reset(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            storage, "DB_PATH", os.path.join(tmp, "cooldown.db")
        ):
            storage.init()
            self.assertTrue(storage.claim_cooldown("wf-1", "zone-a", 60, now=1000))
            self.assertFalse(storage.claim_cooldown("wf-1", "zone-a", 60, now=1030))
            self.assertTrue(storage.claim_cooldown("wf-1", "zone-a", 60, now=1061))


if __name__ == "__main__":
    unittest.main()
