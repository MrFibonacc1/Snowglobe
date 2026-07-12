"""Voice step (Gradium Challenge) — synthesize a spoken alert.

Gradium is a TTS/STT engine, not a telephony provider: it turns text into
audio bytes. So this step is a *speech primitive* — it renders `text` to a
`.wav` and returns its servable URL/path. Delivery stays composable via the
existing step chain: a following `composio`/`mcp` step can ship
`{{steps.<id>.audio_url}}` to Slack, Drive, email, etc. Optionally the alert
is also played out loud on the demo machine (`play_local`).

Fail-closed: the step raises if GRADIUM_API_KEY is missing or Gradium returns
no audio, so a run never reports success without a real clip. The automation
service serves the written file at /audio/{name} (see main.py), giving the
dashboard's Runs view and downstream steps a reachable `audio_url`.

config: {
    "text":       "Spill detected in {{event.location}}",  # templated by engine
    "voice_id":   "YTpq7expH9539ERJ",   # optional; else GRADIUM_VOICE_ID / default
    "play_local": false,                 # optional; afplay on the demo box
    "output_format": "wav"               # optional; wav is browser-friendly
}
"""

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import httpx

TTS_URL = "https://api.gradium.ai/api/post/speech/tts"
DEFAULT_VOICE_ID = "YTpq7expH9539ERJ"

# Where synthesized clips land + how their URL is built. The automation service
# serves this dir at /audio/{name} (see main.py). VOICE_OUTPUT_DIR is honored as
# a legacy alias so existing configs/tests keep working.
_AUDIO_DIR = (
    os.environ.get("VOICE_AUDIO_DIR")
    or os.environ.get("VOICE_OUTPUT_DIR")
    or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "audio")
)
_PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")


def _create_client():
    return httpx.Client(timeout=60)


def execute(config: dict, event: dict) -> dict:
    text = str(config.get("text") or "").strip()
    if not text:
        raise ValueError("voice step needs config.text")
    api_key = os.environ.get("GRADIUM_API_KEY")
    if not api_key:
        raise RuntimeError("voice step not executed: GRADIUM_API_KEY is missing")

    output_format = str(config.get("output_format") or config.get("format") or "wav")
    voice_id = str(
        config.get("voice_id")
        or os.environ.get("GRADIUM_VOICE_ID")
        or DEFAULT_VOICE_ID
    )
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

    # Re-read the dir at call time so per-run env overrides (e.g. tests setting
    # VOICE_OUTPUT_DIR to a tmp dir) take effect.
    output_dir = Path(
        os.environ.get("VOICE_AUDIO_DIR")
        or os.environ.get("VOICE_OUTPUT_DIR")
        or _AUDIO_DIR
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    name = f"voice_{uuid.uuid4().hex[:12]}.{output_format}"
    path = output_dir / name
    path.write_bytes(audio)

    played = False
    if config.get("play_local"):
        played = _play_local(str(path))

    return {
        "executed": True,
        "provider": "gradium",
        "text": text,
        "voice_id": voice_id,
        "format": output_format,
        "bytes": len(audio),
        "audio_path": str(path),
        # Reachable link the dashboard embeds and downstream steps forward.
        "audio_url": f"{_PUBLIC_BASE_URL}/audio/{name}",
        "played": played,
    }


def _play_local(path: str) -> bool:
    """Best-effort play the clip on the demo machine (macOS `afplay`, or a
    couple of common Linux players). Non-blocking; never fails the step."""
    for player in ("afplay", "ffplay", "aplay"):
        binary = shutil.which(player)
        if not binary:
            continue
        args = [binary, path]
        if player == "ffplay":
            args = [binary, "-nodisp", "-autoexit", "-loglevel", "quiet", path]
        try:
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except Exception:  # noqa: BLE001
            return False
    print("[voice] no local audio player found (afplay/ffplay/aplay); skipped playback")
    return False
