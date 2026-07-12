import os
import sys
import unittest
from unittest.mock import patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

from steps import inventory


class InventoryStepTests(unittest.TestCase):
    def test_executor_uses_event_id_for_idempotent_adjustment(self):
        expected = {"sku": "front-shelf-item", "delta": -1, "before": 5, "after": 4, "applied": True}
        with patch.object(inventory.storage, "adjust_inventory", return_value=expected) as adjust:
            output = inventory.execute(
                {"sku": "front-shelf-item", "delta": -1},
                {"event_id": "evt-123"},
            )
        adjust.assert_called_once_with("front-shelf-item", -1, "evt-123")
        self.assertEqual(output["after"], 4)


if __name__ == "__main__":
    unittest.main()
