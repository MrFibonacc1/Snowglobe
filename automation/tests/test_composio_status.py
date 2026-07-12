import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

AUTOMATION_DIR = Path(__file__).resolve().parents[1]
if str(AUTOMATION_DIR) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_DIR))

import composio_status


class _Toolkit:
    def __init__(self, slug):
        self.slug = slug


class _Account:
    def __init__(self, slug, status="ACTIVE"):
        self.toolkit = _Toolkit(slug)
        self.status = status


class _Accounts:
    def __init__(self, accounts):
        self._accounts = accounts

    def list(self):
        return type("AccountPage", (), {"items": self._accounts})()


class _Tools:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error

    def execute(self, **_kwargs):
        if self.error:
            raise self.error
        return self.response


class _Client:
    def __init__(self, accounts=(), response=None, error=None):
        self.connected_accounts = _Accounts(list(accounts))
        self.tools = _Tools(response=response, error=error)


class ComposioStatusTests(unittest.TestCase):
    def test_missing_key_is_not_configured(self):
        with patch.dict(os.environ, {}, clear=True):
            status = composio_status.get_composio_status(refresh=True)

        self.assertFalse(status["key_present"])
        self.assertFalse(status["execution_ready"])
        self.assertFalse(status["configured"])

    def test_management_only_key_reports_execution_denial_and_toolkits(self):
        client = _Client(
            accounts=[_Account("reddit")],
            error=RuntimeError("401 Invalid API key"),
        )
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "redacted"}, clear=True), patch.object(
            composio_status, "_create_client", return_value=client
        ):
            status = composio_status.get_composio_status(refresh=True)

        self.assertTrue(status["key_present"])
        self.assertFalse(status["execution_ready"])
        self.assertEqual(status["toolkits"], {
            "slack": False,
            "googlesheets": False,
            "googledrive": False,
        })
        self.assertIn("execution", status["reason"])

    def test_execution_key_without_accounts_is_not_fully_configured(self):
        client = _Client(response={"successful": True})
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "redacted"}, clear=True), patch.object(
            composio_status, "_create_client", return_value=client
        ):
            status = composio_status.get_composio_status(refresh=True)

        self.assertTrue(status["execution_ready"])
        self.assertFalse(status["configured"])
        self.assertIn("linked accounts", status["reason"])

    def test_execution_key_and_all_accounts_are_configured(self):
        client = _Client(
            accounts=[_Account("slack"), _Account("googlesheets"), _Account("googledrive")],
            response={"successful": True},
        )
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "redacted"}, clear=True), patch.object(
            composio_status, "_create_client", return_value=client
        ):
            status = composio_status.get_composio_status(refresh=True)

        self.assertTrue(status["configured"])
        self.assertIsNone(status["reason"])


if __name__ == "__main__":
    unittest.main()
