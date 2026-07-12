"""Truthful, cached readiness checks for Composio-backed integrations."""

import os
import time
from datetime import datetime, timezone

_TOOLKITS = ("slack", "googlesheets", "googledrive")
_CACHE_TTL_SEC = 60
_cached: dict | None = None
_cached_at = 0.0


def _create_client(api_key: str):
    from composio import Composio

    return Composio(api_key=api_key)


def get_composio_status(refresh: bool = False) -> dict:
    """Return capability state, not merely whether an environment variable exists."""
    global _cached, _cached_at
    now = time.monotonic()
    if not refresh and _cached is not None and now - _cached_at < _CACHE_TTL_SEC:
        return dict(_cached)

    api_key = os.environ.get("COMPOSIO_API_KEY")
    if not api_key:
        result = _status(
            key_present=False,
            execution_ready=False,
            toolkits={name: False for name in _TOOLKITS},
            reason="COMPOSIO_API_KEY is missing",
        )
    else:
        result = _probe(api_key)

    _cached, _cached_at = result, now
    return dict(result)


def _probe(api_key: str) -> dict:
    toolkits = {name: False for name in _TOOLKITS}
    try:
        client = _create_client(api_key)
        accounts = list(getattr(client.connected_accounts.list(), "items", []))
        for account in accounts:
            toolkit = getattr(account, "toolkit", None)
            slug = getattr(toolkit, "slug", None) or getattr(account, "app_name", None)
            if slug in toolkits and getattr(account, "status", "") == "ACTIVE":
                toolkits[slug] = True
    except Exception as exc:  # noqa: BLE001
        return _status(True, False, toolkits, f"Composio account check failed: {_safe_error(exc)}")

    try:
        response = client.tools.execute(
            slug="COMPOSIO_SEARCH_TOOLS",
            user_id=os.environ.get("COMPOSIO_USER_ID", "default"),
            arguments={"query": "slack"},
            dangerously_skip_version_check=True,
        )
        if not isinstance(response, dict) and hasattr(response, "model_dump"):
            response = response.model_dump()
        execution_ready = isinstance(response, dict) and response.get("successful") is True
    except Exception as exc:  # noqa: BLE001
        return _status(
            True,
            False,
            toolkits,
            f"Composio tool execution unavailable: {_safe_error(exc)}",
        )

    if not execution_ready:
        return _status(True, False, toolkits, "Composio did not confirm tool execution")
    missing = [name for name, linked in toolkits.items() if not linked]
    reason = f"Missing linked accounts: {', '.join(missing)}" if missing else None
    return _status(True, True, toolkits, reason)


def _status(
    key_present: bool,
    execution_ready: bool,
    toolkits: dict[str, bool],
    reason: str | None,
) -> dict:
    return {
        "key_present": key_present,
        "execution_ready": execution_ready,
        "toolkits": toolkits,
        "configured": execution_ready and all(toolkits.values()),
        "reason": reason,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def _safe_error(exc: Exception) -> str:
    text = str(exc)
    low = text.lower()
    if "401" in low or "invalid api key" in low or "unauthorized" in low:
        return "key lacks tool-execution rights"
    if "connection" in low:
        return "connection failed"
    return type(exc).__name__
