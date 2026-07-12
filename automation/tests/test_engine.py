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
from steps.h_agent import AgentExecutionError


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


class EngineAgentFailureTests(unittest.TestCase):
    def test_agent_timeout_retains_diagnostics_and_skips_dependent_slack(self):
        event = {
            "event_id": "evt_agent_timeout",
            "event_type": "spill",
            "location": "floor",
            "confidence": 0.99,
        }
        workflow = {
            "id": "wf_agent_timeout",
            "name": "Agent then notify",
            "enabled": True,
            "trigger": {"event_type": "spill", "min_confidence": 0.5},
            "steps": [
                {"id": "s1", "type": "h_agent", "config": {"instructions": "investigate"}},
                {
                    "id": "s2",
                    "type": "composio",
                    "config": {
                        "action": "slack_message",
                        "channel": "#alerts",
                        "text": "{{steps.s1.answer}}",
                    },
                },
            ],
        }
        run = engine._new_run(workflow, event)
        error = AgentExecutionError(
            "agent_api exceeded its time budget while status=running",
            {
                "backend": "agent_api",
                "session_id": "session-123",
                "agent_view_url": "https://example.test/replay/session-123",
                "status": "running",
                "steps": 27,
                "duration_sec": 150.0,
            },
        )

        with patch.object(engine, "execute_step", side_effect=error), patch.object(
            engine.storage, "update_run"
        ):
            asyncio.run(engine.execute_run(run, workflow, event))

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["steps"][0]["status"], "failed")
        self.assertEqual(run["steps"][0]["output"].get("session_id"), "session-123")
        self.assertEqual(run["steps"][0]["output"].get("steps"), 27)
        self.assertIn("time budget", run["steps"][0]["output"]["error"])
        self.assertEqual(run["steps"][1]["status"], "skipped")


if __name__ == "__main__":
    unittest.main()
