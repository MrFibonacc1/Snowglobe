import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

AUTOMATION_DIR = Path(__file__).resolve().parents[1]
if str(AUTOMATION_DIR) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_DIR))

from steps import composio_step


class _Tools:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error

    def execute(self, **_kwargs):
        if self.error:
            raise self.error
        return self.result


class _Client:
    def __init__(self, result=None, error=None):
        self.tools = _Tools(result=result, error=error)


class ComposioStepTests(unittest.TestCase):
    config = {"action": "slack_message", "channel": "#alerts", "text": "Spill"}

    def test_missing_key_fails_instead_of_returning_stub_success(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(composio_step.ComposioExecutionError):
                composio_step.execute(self.config, {})

    def test_execution_denied_fails_step(self):
        client = _Client(error=RuntimeError("401 Invalid API key"))
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "redacted"}, clear=True), patch.object(
            composio_step, "_create_client", return_value=client
        ):
            with self.assertRaisesRegex(composio_step.ComposioExecutionError, "execution-enabled"):
                composio_step.execute(self.config, {})

    def test_missing_connected_account_fails_step(self):
        client = _Client(error=RuntimeError("No connected account for toolkit slack"))
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "redacted"}, clear=True), patch.object(
            composio_step, "_create_client", return_value=client
        ):
            with self.assertRaisesRegex(composio_step.ComposioExecutionError, "connected account"):
                composio_step.execute(self.config, {})

    def test_unsuccessful_sdk_response_fails_step(self):
        client = _Client(result={"successful": False, "error": "channel_not_found"})
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "redacted"}, clear=True), patch.object(
            composio_step, "_create_client", return_value=client
        ):
            with self.assertRaisesRegex(composio_step.ComposioExecutionError, "channel_not_found"):
                composio_step.execute(self.config, {})

    def test_confirmed_success_returns_non_stubbed_result(self):
        client = _Client(result={"successful": True, "data": {"message_ts": "123"}})
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "redacted"}, clear=True), patch.object(
            composio_step, "_create_client", return_value=client
        ):
            output = composio_step.execute(self.config, {})

        self.assertEqual(output["executed"], True)
        self.assertEqual(output["action"], "slack_message")
        self.assertEqual(output["result"]["successful"], True)


if __name__ == "__main__":
    unittest.main()
