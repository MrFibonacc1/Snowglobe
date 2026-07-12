import os
import sys
import unittest
from unittest.mock import patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

from steps import h_agent


class _Response:
    def __init__(self, body):
        self._body = body

    def raise_for_status(self):
        return None

    def json(self):
        return self._body


class _Client:
    def __init__(self, snapshots):
        self.snapshots = iter(snapshots)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, path, json):
        return _Response({
            "id": "session-123",
            "agent_view_url": "https://example.test/replay/session-123",
            "status": {"status": "running", "steps": 14},
        })

    def get(self, path):
        return _Response(next(self.snapshots))


class AgentApiCompletionTests(unittest.TestCase):
    def _run(self, snapshot, times):
        snapshots = snapshot if isinstance(snapshot, list) else [snapshot]
        client = _Client(snapshots)
        with patch.dict(os.environ, {"HAI_API_KEY": "redacted"}, clear=False), patch.object(
            h_agent.httpx, "Client", return_value=client
        ), patch.object(h_agent.time, "sleep"), patch.object(
            h_agent.time, "time", side_effect=times
        ):
            return h_agent._run_agent_api({
                "instructions": "finish the task",
                "timeout_sec": 150,
            })

    def test_running_session_at_budget_raises_instead_of_returning_partial_output(self):
        snapshot = {
            "id": "session-123",
            "status": {"status": "running", "steps": 27},
            "latest_answer": None,
        }
        with self.assertRaisesRegex(RuntimeError, "time budget"):
            self._run([snapshot, snapshot], [0, 0, 151, 151])

    def test_terminal_session_without_answer_raises(self):
        snapshot = {
            "id": "session-123",
            "finished_at": "2026-07-12T00:00:00Z",
            "status": {"status": "completed", "steps": 14},
            "latest_answer": None,
        }
        with self.assertRaisesRegex(RuntimeError, "answer"):
            self._run(snapshot, [0, 0, 1])

    def test_terminal_session_with_answer_returns_completed_output(self):
        snapshot = {
            "id": "session-123",
            "finished_at": "2026-07-12T00:00:00Z",
            "status": {"status": "completed", "steps": 14},
            "latest_answer": "Task completed cleanly.",
        }
        output = self._run(snapshot, [0, 0, 1])
        self.assertEqual(output["answer"], "Task completed cleanly.")
        self.assertEqual(output["status"], "completed")

    def test_final_refresh_recovers_completion_at_budget_boundary(self):
        running = {
            "id": "session-123",
            "status": {"status": "running", "steps": 27},
            "latest_answer": None,
        }
        completed = {
            "id": "session-123",
            "finished_at": "2026-07-12T00:02:31Z",
            "status": {"status": "completed", "steps": 28},
            "latest_answer": "Finished during the budget boundary.",
        }

        output = self._run([running, completed], [0, 0, 151, 151])

        self.assertEqual(output["status"], "completed")
        self.assertEqual(output["answer"], "Finished during the budget boundary.")


class ModeValidationTests(unittest.TestCase):
    def test_unknown_mode_raises_instead_of_silent_mock(self):
        # A misspelled mode used to fall through to a fake mock "success".
        with patch.dict(os.environ, {"H_AGENT_MODE": "agent_mpc"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "unknown H_AGENT_MODE"):
                h_agent.execute({"task": "custom_url"}, {})

    def test_explicit_mock_mode_still_works(self):
        with patch.dict(os.environ, {"H_AGENT_MODE": "mock"}, clear=False):
            out = h_agent.execute({"task": "ticket", "url": "http://x"}, {})
        self.assertEqual(out["backend"], "mock")


if __name__ == "__main__":
    unittest.main()
