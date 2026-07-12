import asyncio
import os
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

AUTOMATION_DIR = Path(__file__).resolve().parents[1]
if str(AUTOMATION_DIR) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_DIR))

import engine


class EngineComposioFailureTests(unittest.TestCase):
    def test_unavailable_composio_marks_step_and_run_failed(self):
        event = {
            "event_id": "evt_test",
            "event_type": "spill",
            "location": "floor",
            "confidence": 0.99,
        }
        workflow = {
            "id": "wf_test",
            "name": "Notify team",
            "enabled": True,
            "trigger": {"event_type": "spill", "min_confidence": 0.5},
            "steps": [{
                "id": "s2",
                "type": "composio",
                "config": {"action": "slack_message", "channel": "#alerts", "text": "Spill"},
            }],
        }
        run = engine._new_run(workflow, event)
        snapshots = []

        with patch.dict(os.environ, {}, clear=True), patch.object(
            engine.storage, "update_run", side_effect=lambda value: snapshots.append(deepcopy(value))
        ):
            asyncio.run(engine.execute_run(run, workflow, event))

        self.assertEqual(run["steps"][0]["status"], "failed")
        self.assertIn("action was not sent", run["steps"][0]["output"]["error"])
        self.assertEqual(run["status"], "failed")
        self.assertTrue(any(item["status"] == "failed" for item in snapshots))


if __name__ == "__main__":
    unittest.main()
