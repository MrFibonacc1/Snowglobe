"""Truthful, cached readiness checks for Composio-backed integrations."""

import os
import time
from datetime import datetime, timezone

_TOOLKITS = ("slack", "googlesheets", "googledrive")
# Dashboard integration ids (and a couple of common spellings) → Composio slug.
_TOOLKIT_ALIASES = {
    "slack": "slack",
    "gsheets": "googlesheets",
    "googlesheets": "googlesheets",
    "sheets": "googlesheets",
    "gdrive": "googledrive",
    "googledrive": "googledrive",
    "drive": "googledrive",
}
_CACHE_TTL_SEC = 60
_cached: dict | None = None
_cached_at = 0.0


def _invalidate_cache() -> None:
    global _cached, _cached_at
    _cached, _cached_at = None, 0.0


def initiate_connection(toolkit: str) -> dict:
    """Start a Composio OAuth link for one toolkit and return the URL the user
    visits to authorize. Uses the same user_id our step executes under so the
    resulting account is actually usable by workflows.

    Raises ValueError for an unknown toolkit, RuntimeError if Composio can't
    start the flow (missing/again-unauthorized key)."""
    # Accept any Composio slug (the catalog browser passes arbitrary ones); the
    # aliases just map our friendly card ids to the canonical slug.
    raw = toolkit.strip().lower()
    slug = _TOOLKIT_ALIASES.get(raw, raw)
    if not slug:
        raise ValueError(f"unsupported toolkit: {toolkit!r}")
    api_key = os.environ.get("COMPOSIO_API_KEY")
    if not api_key:
        raise RuntimeError("COMPOSIO_API_KEY is missing")

    user_id = os.environ.get("COMPOSIO_USER_ID", "default")
    client = _create_client(api_key)
    request = client.toolkits.authorize(user_id=user_id, toolkit=slug)
    redirect_url = getattr(request, "redirect_url", None)
    if not redirect_url:
        raise RuntimeError("Composio did not return an authorization URL")

    # A new link changes readiness; force the next /status probe to re-check
    # instead of serving the (about-to-be-stale) 60s cache.
    _invalidate_cache()
    return {
        "toolkit": slug,
        "user_id": user_id,
        "redirect_url": redirect_url,
        "connection_id": getattr(request, "id", None),
    }


def _create_client(api_key: str):
    from composio import Composio

    return Composio(api_key=api_key)


_catalog_cache: list | None = None
_catalog_at = 0.0
_CATALOG_TTL_SEC = 3600


def get_catalog(refresh: bool = False) -> list[dict]:
    """The full Composio toolkit catalog (≈1000 apps), trimmed to what the
    dashboard's Add-integration browser needs. Cached — the catalog is static."""
    global _catalog_cache, _catalog_at
    now = time.monotonic()
    if not refresh and _catalog_cache is not None and now - _catalog_at < _CATALOG_TTL_SEC:
        return list(_catalog_cache)

    api_key = os.environ.get("COMPOSIO_API_KEY")
    if not api_key:
        raise RuntimeError("COMPOSIO_API_KEY is missing")

    client = _create_client(api_key)
    res = client.toolkits.list()
    items = getattr(res, "items", res) or []
    out: list[dict] = []
    for t in items:
        d = t.model_dump() if hasattr(t, "model_dump") else t
        if not isinstance(d, dict) or not d.get("slug"):
            continue
        meta = d.get("meta") or {}
        out.append({
            "slug": d.get("slug"),
            "name": d.get("name") or d.get("slug"),
            "description": (meta.get("description") or "")[:160],
            "logo": meta.get("logo"),
            "categories": [c.get("name") for c in (meta.get("categories") or []) if isinstance(c, dict)],
            "tools_count": int(meta.get("tools_count") or 0),
            "no_auth": bool(d.get("no_auth")),
        })
    # Richest integrations first, then alphabetical.
    out.sort(key=lambda x: (-x["tools_count"], x["name"].lower()))
    _catalog_cache, _catalog_at = out, now
    return list(out)


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
