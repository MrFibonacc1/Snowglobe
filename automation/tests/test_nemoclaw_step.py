import os
import sys
import unittest
from unittest.mock import patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

from steps import h_agent


class NemoClawContractTests(unittest.TestCase):
    def test_completed_artifact_returns_answer(self):
        with patch.object(h_agent.time, "time", side_effect=[10, 11]):
            output = h_agent._nemoclaw_output(
                {"id": "task-1", "artifacts": [{"parts": [{"kind": "text", "text": "done"}]}]},
                "completed", 10, {},
            )
        self.assertEqual(output["answer"], "done")

    def test_working_state_fails_closed(self):
        with patch.object(h_agent.time, "time", return_value=160):
            with self.assertRaisesRegex(h_agent.AgentExecutionError, "time budget"):
                h_agent._nemoclaw_output({"id": "task-1"}, "working", 10, {})


if __name__ == "__main__":
    unittest.main()
