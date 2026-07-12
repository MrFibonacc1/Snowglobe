"""Gradium text-to-speech step; succeeds only after audio is synthesized."""

import os
import uuid
from pathlib import Path

import httpx

TTS_URL = "https://api.gradium.ai/api/post/speech/tts"
DEFAULT_VOICE_ID = "YTpq7expH9539ERJ"


def _create_client():
    return httpx.Client(timeout=60)


def execute(config: dict, event: dict) -> dict:
    text = str(config.get("text") or "").strip()
    if not text:
        raise ValueError("voice step needs config.text")
    api_key = os.environ.get("GRADIUM_API_KEY")
    if not api_key:
        raise RuntimeError("voice step not executed: GRADIUM_API_KEY is missing")

    output_format = str(config.get("output_format") or "wav")
    voice_id = str(config.get("voice_id") or os.environ.get("GRADIUM_VOICE_ID") or DEFAULT_VOICE_ID)
    with _create_client() as client:
        response = client.post(
            TTS_URL,
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
            json={
                "text": text, "voice_id": voice_id,
                "output_format": output_format, "only_audio": True,
            },
        )
        response.raise_for_status()
        audio = response.content
    if not audio:
        raise RuntimeError("Gradium did not return synthesized audio")

    output_dir = Path(os.environ.get("VOICE_OUTPUT_DIR", "/tmp/snowglobe-voice"))
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"voice_{uuid.uuid4().hex[:12]}.{output_format}"
    path.write_bytes(audio)
    return {
        "executed": True, "provider": "gradium", "text": text,
        "voice_id": voice_id, "format": output_format,
        "bytes": len(audio), "audio_path": str(path),
    }
