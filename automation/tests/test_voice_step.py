import os
import sys
import tempfile
import unittest
from unittest.mock import patch

AUTOMATION_DIR = os.path.dirname(os.path.dirname(__file__))
if AUTOMATION_DIR not in sys.path:
    sys.path.insert(0, AUTOMATION_DIR)

from steps import voice


class _Response:
    status_code = 200
    content = b"RIFF-real-wave-data"

    def raise_for_status(self):
        return None


class _Client:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def post(self, url, **kwargs):
        self.url = url
        self.kwargs = kwargs
        return _Response()


class VoiceStepTests(unittest.TestCase):
    def test_missing_key_fails_instead_of_stub_success(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "GRADIUM_API_KEY"):
                voice.execute({"text": "Alert"}, {})

    def test_confirmed_audio_is_persisted(self):
        client = _Client()
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "GRADIUM_API_KEY": "redacted", "VOICE_OUTPUT_DIR": tmp,
        }, clear=True), patch.object(voice, "_create_client", return_value=client):
            output = voice.execute({"text": "Spill detected", "voice_id": "voice-1"}, {})
        self.assertTrue(output["executed"])
        self.assertEqual(output["provider"], "gradium")
        self.assertGreater(output["bytes"], 4)
        self.assertEqual(client.kwargs["headers"]["x-api-key"], "redacted")


if __name__ == "__main__":
    unittest.main()
