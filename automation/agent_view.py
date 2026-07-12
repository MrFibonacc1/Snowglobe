"""Live agent-view proxy for the dashboard's Overview "watch the agent move" box.

The H Agent API exposes a per-session event stream at
`GET /sessions/{id}/events` — the agent's *actual movements*: each browser
screenshot it sees (`observation_event`), what it's thinking and about to do
(`policy_event` → reasoning + tool calls like go_to_web / click / write), the
result of each action (`tool_result`), and the final answer (`answer_event`).

We can't hit that endpoint or its screenshot URLs from the browser: they need
the H API key (Bearer auth) and H blocks iframe embedding of the session page
(X-Frame-Options: DENY). So this module proxies both, server-side:

  * `fetch_session_feed(session_id)` → a compact, browser-safe feed of the
    agent's steps (latest screenshot as a proxied URL, cursor position, and an
    ordered action log).
  * `fetch_screenshot(url)` → streams an authed H trajectory image back to the
    browser (the only host we'll proxy is H's own API).

This is the data the Overview's LiveAgentViewer polls to render a Claude-cowork
style live view: the agent's screen with its cursor, and a running action log.
"""

import os

import httpx

_REGION = os.environ.get("HAI_AGENT_REGION", "eu").lower()
_DEFAULT_BASE = (
    "https://agp.hcompany.ai/api/v2"
    if _REGION == "us"
    else "https://agp.eu.hcompany.ai/api/v2"
)
AGENT_BASE_URL = os.environ.get("HAI_AGENT_BASE_URL", _DEFAULT_BASE)

# Only screenshot URLs on H's own API hosts are ever proxied — this is a
# credentialed fetch, so we must not let it be pointed at arbitrary hosts.
_ALLOWED_SCREENSHOT_HOSTS = (
    "agp.hcompany.ai",
    "agp.eu.hcompany.ai",
    "agp.us.hcompany.ai",
)


class AgentViewUnavailable(RuntimeError):
    """H isn't configured, or the session/events can't be fetched."""


def _api_key() -> str:
    key = os.environ.get("HAI_API_KEY")
    if not key:
        raise AgentViewUnavailable("HAI_API_KEY is not set")
    return key


def _tool_summary(tool_name: str, args: dict) -> str:
    """Human-readable one-liner for a tool call — what the agent is doing."""
    args = args or {}
    if tool_name == "go_to_web":
        return f"Navigate to {args.get('url', '')}".strip()
    if tool_name in ("write", "type"):
        text = str(args.get("text", ""))
        clip = text if len(text) <= 60 else text[:57] + "…"
        return f'Type "{clip}"'
    if tool_name == "click":
        return "Click"
    if tool_name in ("scroll", "scroll_down", "scroll_up"):
        return "Scroll"
    if tool_name == "answer":
        return "Finish and answer"
    if tool_name == "wait":
        return "Wait"
    # Fall back to the raw tool name; better than nothing for new tools.
    return tool_name.replace("_", " ").capitalize()


def _screenshot_proxy_url(raw_url: str) -> str:
    """Rewrite an authed H trajectory image URL into our own proxy path."""
    from urllib.parse import quote

    return f"/agent/screenshot?url={quote(raw_url, safe='')}"


def fetch_session_feed(session_id: str) -> dict:
    """Return a browser-safe feed of the agent's movements for one session.

    Shape:
      {
        "session_id": "...",
        "status": "running" | "completed" | ...,
        "latest_screenshot": "/agent/screenshot?url=..." | null,
        "cursor": [x, y] | null,          # in viewport pixels
        "viewport": [w, h] | null,
        "url": "https://…",               # page the agent is on
        "steps": [                        # ordered oldest → newest
          {"index": 0, "kind": "action", "title": "Navigate to …",
           "detail": "…thought…", "screenshot": "/agent/screenshot?url=…",
           "cursor": [x, y], "viewport": [w, h], "url": "…"},
          ...
        ],
        "answer": "…" | null,
      }
    """
    key = _api_key()
    headers = {"Authorization": f"Bearer {key}"}
    with httpx.Client(base_url=AGENT_BASE_URL, headers=headers, timeout=20) as client:
        r = client.get(f"/sessions/{session_id}/events")
        if r.status_code == 404:
            raise AgentViewUnavailable(f"session {session_id} not found")
        r.raise_for_status()
        payload = r.json()

    items = payload.get("items") or []
    steps: list[dict] = []
    latest_screenshot: str | None = None
    latest_cursor: list | None = None
    latest_viewport: list | None = None
    latest_url: str | None = None
    answer: str | None = None
    status = "running"

    # Track the most recent observation (screenshot + page metadata) so we can
    # attach it to the policy/action that follows it — the agent decides based
    # on what it just saw, so pairing them reads naturally in the UI.
    pending_shot: str | None = None
    pending_cursor: list | None = None
    pending_viewport: list | None = None
    pending_url: str | None = None

    idx = 0
    for it in items:
        if it.get("type") != "AgentEvent":
            continue
        data = it.get("data") or {}
        kind = data.get("kind")

        if kind == "observation_event":
            img = data.get("image") or {}
            src = img.get("source")
            md = data.get("metadata") or {}
            if src:
                pending_shot = _screenshot_proxy_url(src)
                latest_screenshot = pending_shot
            pending_cursor = md.get("cursor_position")
            pending_viewport = md.get("viewport_size")
            pending_url = md.get("url")
            if pending_cursor is not None:
                latest_cursor = pending_cursor
            if pending_viewport is not None:
                latest_viewport = pending_viewport
            if pending_url is not None:
                latest_url = pending_url

        elif kind == "policy_event":
            thought = (data.get("content") or data.get("reasoning_content") or "").strip()
            tool_reqs = data.get("tool_reqs") or []
            title = "Thinking"
            if tool_reqs:
                first = tool_reqs[0]
                title = _tool_summary(first.get("tool_name", ""), first.get("args") or {})
            steps.append({
                "index": idx,
                "kind": "action",
                "title": title,
                "detail": thought[:400] if thought else None,
                "screenshot": pending_shot,
                "cursor": pending_cursor,
                "viewport": pending_viewport,
                "url": pending_url,
            })
            idx += 1
            # A screenshot belongs to the action that reacted to it — don't
            # re-attach the same shot to the next action if no new obs arrived.
            pending_shot = None

        elif kind == "answer_event":
            answer = (data.get("answer") or "").strip() or None
            steps.append({
                "index": idx,
                "kind": "answer",
                "title": "Answer",
                "detail": answer,
                "screenshot": pending_shot,
                "cursor": pending_cursor,
                "viewport": pending_viewport,
                "url": pending_url,
            })
            idx += 1
            status = "completed"

    return {
        "session_id": session_id,
        "status": status,
        "latest_screenshot": latest_screenshot,
        "cursor": latest_cursor,
        "viewport": latest_viewport,
        "url": latest_url,
        "steps": steps,
        "answer": answer,
    }


def fetch_screenshot(url: str) -> tuple[bytes, str]:
    """Fetch an authed H trajectory screenshot; return (bytes, content_type).

    Only H API hosts are allowed — this is a credentialed request, so we refuse
    to be used as an open proxy toward arbitrary URLs.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in _ALLOWED_SCREENSHOT_HOSTS:
        raise AgentViewUnavailable("screenshot url host not allowed")
    key = _api_key()
    with httpx.Client(
        headers={"Authorization": f"Bearer {key}"},
        timeout=20,
        # H's trajectory URL 302-redirects to a presigned bucket URL; follow it.
        # httpx drops the Authorization header on cross-origin redirects, so the
        # H key never leaks to the storage bucket.
        follow_redirects=True,
    ) as client:
        r = client.get(url)
        r.raise_for_status()
        content_type = r.headers.get("content-type", "image/png")
        return r.content, content_type
