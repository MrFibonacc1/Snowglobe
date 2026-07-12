"""go2rtc gateway client: normalize any camera source to a plain RTSP stream.

go2rtc (https://github.com/AlexxIT/go2rtc) fronts heterogeneous cameras — ONVIF,
proprietary RTSP dialects, HTTP/MJPEG, USB — and re-serves each as a clean RTSP
stream on a stable URL. Routing cameras through it means the sampler only ever
has to speak one protocol.

Everything here is BEST-EFFORT: go2rtc is an optional runtime dependency, so
every call swallows network errors (logging to stderr) and the caller falls back
to the direct source when the gateway is unreachable.

    GO2RTC_URL   REST API base (default http://localhost:1984)
    GO2RTC_RTSP  served RTSP base (default rtsp://localhost:8554)
"""
from __future__ import annotations

import os
import re
import sys
from typing import Optional
from urllib.parse import quote, urlparse, urlunparse

import requests

# Short timeout everywhere: the gateway is on the LAN (usually localhost), so a
# slow response means it's effectively down and we should fall back fast.
_TIMEOUT = 3.0


def _url() -> str:
    return os.getenv("GO2RTC_URL", "http://localhost:1984").rstrip("/")


def _rtsp() -> str:
    return os.getenv("GO2RTC_RTSP", "rtsp://localhost:8554").rstrip("/")


def slug(name: str) -> str:
    """URL/stream-safe stream name: lowercase alnum + dashes, never empty."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return s or "cam"


def _redact(url: str) -> str:
    """Strip any `user:pass@` userinfo from a URL so it's safe to log.

    `rtsp://user:pass@host/path` → `rtsp://***@host/path`. Anything that doesn't
    parse as a URL with an authority is returned unchanged (it carries no creds).
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return "<redacted>"
    if not parsed.hostname or "@" not in parsed.netloc:
        return url
    host = parsed.hostname
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    netloc = f"***@{host}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


def available() -> bool:
    """True if the go2rtc REST API answers within the timeout."""
    try:
        resp = requests.get(f"{_url()}/api/streams", timeout=_TIMEOUT)
        return resp.ok
    except requests.RequestException:
        return False


def register(name: str, src: str) -> Optional[str]:
    """Add/replace a go2rtc stream for `src` and return its normalized RTSP URL.

    `name` is used verbatim as the go2rtc stream key, so the caller is
    responsible for passing a unique, stream-safe id (see `slug`).

    Returns ``None`` if the PUT fails (network error or a 4xx/5xx from go2rtc,
    e.g. it can't open the src) so the caller falls back to the direct source
    instead of sampling a stream go2rtc isn't actually serving.
    """
    stream = name
    try:
        resp = requests.put(
            f"{_url()}/api/streams",
            params={"name": stream, "src": src},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        # Never interpolate the raw exception: a requests error embeds the full
        # request URL, whose `src` param carries the RTSP credentials. Log the
        # stream key, the error type, and a redacted src only.
        print(
            f"  ! go2rtc register({stream!r}) failed: {type(e).__name__} "
            f"(src={_redact(src)})",
            file=sys.stderr,
        )
        return None
    return f"{_rtsp()}/{quote(stream)}"


def unregister(name: str) -> None:
    """Remove a go2rtc stream by its stream key. Never raises.

    `name` is the go2rtc stream key (the unique id passed to `register`), used
    verbatim — not re-slugged.
    """
    stream = name
    try:
        requests.delete(
            f"{_url()}/api/streams",
            params={"src": stream},
            timeout=_TIMEOUT,
        )
    except requests.RequestException as e:
        print(
            f"  ! go2rtc unregister({stream!r}) failed: {type(e).__name__}",
            file=sys.stderr,
        )
