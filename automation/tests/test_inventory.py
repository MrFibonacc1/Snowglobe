import os
import sys
import tempfile
import unittest
from unittest.mock import patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

import storage


class InventoryStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "inventory.db")
        self.db_patch = patch.object(storage, "DB_PATH", self.db)
        self.db_patch.start()
        storage.init()
        storage.upsert_inventory({"sku": "front-shelf-item", "name": "Front shelf item", "quantity": 5})

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_adjustment_decrements_and_is_idempotent_per_event(self):
        first = storage.adjust_inventory("front-shelf-item", -1, "evt-1")
        duplicate = storage.adjust_inventory("front-shelf-item", -1, "evt-1")
        self.assertEqual((first["before"], first["after"], first["applied"]), (5, 4, True))
        self.assertEqual((duplicate["before"], duplicate["after"], duplicate["applied"]), (5, 4, False))
        self.assertEqual(storage.list_inventory()[0]["quantity"], 4)

    def test_unknown_sku_fails(self):
        with self.assertRaisesRegex(ValueError, "unknown SKU"):
            storage.adjust_inventory("missing", -1, "evt-2")

    def test_quantity_never_drops_below_zero(self):
        with self.assertRaisesRegex(ValueError, "below zero"):
            storage.adjust_inventory("front-shelf-item", -6, "evt-3")


if __name__ == "__main__":
    unittest.main()
