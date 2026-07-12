import os
import sys
import unittest
from unittest.mock import patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

from steps import mcp_step


class _Response:
    def __init__(self, body, headers=None):
        self._body = body
        self.headers = headers or {"content-type": "application/json"}
        self.text = ""
    def raise_for_status(self): pass
    def json(self): return self._body


class _Client:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.headers = {}
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def post(self, url, json): return next(self.responses)


class McpStepTests(unittest.TestCase):
    def test_tool_success_is_returned(self):
        client = _Client([
            _Response({"jsonrpc": "2.0", "result": {}}, {"content-type": "application/json", "Mcp-Session-Id": "s1"}),
            _Response({}),
            _Response({"jsonrpc": "2.0", "result": {"content": [{"type": "text", "text": "updated"}]}}),
        ])
        with patch.object(mcp_step.httpx, "Client", return_value=client):
            output = mcp_step.execute({"server_url": "http://mcp.test", "tool": "update", "arguments": {}}, {})
        self.assertEqual(output["result"], "updated")
        self.assertFalse(output["is_error"])

    def test_tool_error_fails_step(self):
        client = _Client([
            _Response({"jsonrpc": "2.0", "result": {}}), _Response({}),
            _Response({"jsonrpc": "2.0", "result": {"isError": True, "content": [{"type": "text", "text": "denied"}]}}),
        ])
        with patch.object(mcp_step.httpx, "Client", return_value=client):
            with self.assertRaisesRegex(RuntimeError, "denied"):
                mcp_step.execute({"server_url": "http://mcp.test", "tool": "update"}, {})


if __name__ == "__main__":
    unittest.main()
