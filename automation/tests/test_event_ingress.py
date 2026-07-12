import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

import main


class EventIngressTests(unittest.TestCase):
    def test_discovery_alias_is_canonical_before_persistence_and_matching(self):
        event = {
            "event_id": "evt_alias",
            "event_type": "person_holding_item",
            "timestamp": "2026-07-12T00:00:00Z",
            "confidence": 0.9,
            "location": "front_shelf",
            "payload": {"detail": "shopper selected product"},
        }
        with patch.object(main.storage, "insert_event") as insert, patch.object(
            main.engine, "handle_event", new=AsyncMock(return_value=[])
        ) as handle:
            asyncio.run(main.post_event(event))

        persisted = insert.call_args.args[0]
        dispatched = handle.call_args.args[0]
        self.assertEqual(persisted["event_type"], "item_removed_from_shelf")
        self.assertEqual(dispatched["event_type"], "item_removed_from_shelf")
        self.assertEqual(persisted["payload"]["raw_event_type"], "person_holding_item")


if __name__ == "__main__":
    unittest.main()
