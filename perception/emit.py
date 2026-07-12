"""Turn a Verdict + Frame into a schema-valid event, then POST it to the
automation service or append it to a JSONL dump file."""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

import requests

# Load the shared event schema once for optional validation.
_SCHEMA_PATH = Path(__file__).resolve().parents[1] / "shared" / "event_schema.json"
try:
    import jsonschema

    _SCHEMA = json.loads(_SCHEMA_PATH.read_text())
except Exception:  # jsonschema missing or schema unreadable — validation is best-effort
    jsonschema = None
    _SCHEMA = None


def build_event(event_type, verdict, zone, frame, snapshot_base_url=None, model=None):
    snapshot_url = None
    if frame.path:
        snapshot_url = (
            f"{snapshot_base_url.rstrip('/')}/{frame.path}" if snapshot_base_url else frame.path
        )

    event = {
        "event_id": uuid.uuid4().hex,
        "event_type": event_type,
        "timestamp": frame.timestamp.isoformat().replace("+00:00", "Z"),
        "confidence": round(verdict.confidence, 3),
        "location": zone,
    }
    if snapshot_url:
        event["snapshot_url"] = snapshot_url

    payload = verdict.payload()
    if model:
        payload["model"] = model
    if payload:
        event["payload"] = payload
    return event


def validate(event) -> str | None:
    """Return None if valid, else a short error string. No-op if jsonschema
    isn't installed."""
    if not _SCHEMA or not jsonschema:
        return None
    try:
        jsonschema.validate(event, _SCHEMA)
        return None
    except jsonschema.ValidationError as e:  # type: ignore[attr-defined]
        return e.message


class Emitter:
    """Dump mode (a `dump_path` is set) writes JSONL and does NOT post.
    Otherwise, POSTs to {automation_url}/events."""

    def __init__(self, automation_url=None, dump_path=None):
        self.automation_url = automation_url
        self.dump_path = dump_path
        self._fh = open(dump_path, "a", encoding="utf-8") if dump_path else None
        self._session = requests.Session() if not dump_path else None
        self.sent = 0
        self.failed = 0

    def emit(self, event) -> bool:
        err = validate(event)
        if err:
            print(f"  ! event failed schema validation: {err}", file=sys.stderr)

        if self._fh:
            self._fh.write(json.dumps(event) + "\n")
            self._fh.flush()
            self.sent += 1
            return True

        try:
            resp = self._session.post(
                f"{self.automation_url.rstrip('/')}/events", json=event, timeout=5
            )
            resp.raise_for_status()
            self.sent += 1
            return True
        except requests.RequestException as e:
            self.failed += 1
            print(f"  ! POST /events failed ({e}) — is automation/ running?", file=sys.stderr)
            return False

    def close(self):
        if self._fh:
            self._fh.close()
        if getattr(self, "_session", None):
            self._session.close()
