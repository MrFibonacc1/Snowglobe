"""ONVIF discovery + stream-URL resolution for network cameras.

Two optional packages back this module:

* ``wsdiscovery`` — WS-Discovery multicast probe to find ONVIF devices on the LAN.
* ``onvif-zeep`` (imported as ``onvif``) — the ONVIF SOAP client used to read
  device info and resolve a profile's RTSP stream URI.

Both are OPTIONAL runtime deps. The imports are guarded so ``import
perception.onvif`` always succeeds; ``AVAILABLE`` reports whether the probe/
resolve functions can actually run, and each function raises a clear
``RuntimeError`` (or returns ``[]``) when the deps are missing.
"""
from __future__ import annotations

import socket
import sys
from contextlib import contextmanager
from urllib.parse import urlparse, urlunparse

try:
    from wsdiscovery.discovery import ThreadedWSDiscovery
    from wsdiscovery import QName

    _WSD_OK = True
except Exception:  # package not installed
    ThreadedWSDiscovery = None
    QName = None
    _WSD_OK = False

try:
    from onvif import ONVIFCamera

    # zeep backs onvif-zeep; a real operation timeout is wired through its
    # Transport when available. Guarded independently so an odd install still
    # falls back to the socket-level bound below.
    try:
        from zeep.transports import Transport as _ZeepTransport
    except Exception:
        _ZeepTransport = None

    _ONVIF_OK = True
except Exception:  # package not installed
    ONVIFCamera = None
    _ZeepTransport = None
    _ONVIF_OK = False

# Hard bound on every ONVIF SOAP call. A caller-supplied xaddr can point at a
# host that accepts TCP but never replies; without a timeout that blocks a
# FastAPI threadpool worker forever, so ~40 such requests starve the pool and
# stall every endpoint. Applied via the zeep Transport AND a socket-level
# fallback so a hang is bounded even if zeep ignores the transport.
_ONVIF_TIMEOUT = 8.0

# Discovery needs wsdiscovery; resolve needs onvif. AVAILABLE means the common
# case (probe + resolve) is usable; individual functions still guard on the
# specific dep they require.
AVAILABLE = _WSD_OK and _ONVIF_OK

# The ONVIF device service always lives at /onvif/device_service on the xaddr host.
_ONVIF_TYPE = "NetworkVideoTransmitter"
_ONVIF_NS = "http://www.onvif.org/ver10/network/wsdl"


@contextmanager
def _bounded_socket():
    """Bound blocking socket waits to ``_ONVIF_TIMEOUT`` for the duration of the
    block, restoring the previous default on exit. Backstops the zeep Transport
    timeout so a wedged host can never hang a worker even if zeep ignores it."""
    prev = socket.getdefaulttimeout()
    socket.setdefaulttimeout(_ONVIF_TIMEOUT)
    try:
        yield
    finally:
        socket.setdefaulttimeout(prev)


def _make_camera(host: str, port: int, username: str, password: str):
    """Build an ONVIFCamera with a zeep Transport that carries a real operation
    timeout, falling back to the plain constructor if this onvif-zeep version
    doesn't accept a ``transport=`` kwarg (the socket-level bound still applies).
    """
    if _ZeepTransport is not None:
        transport = _ZeepTransport(
            timeout=_ONVIF_TIMEOUT, operation_timeout=_ONVIF_TIMEOUT
        )
        try:
            return ONVIFCamera(host, port, username, password, transport=transport)
        except TypeError:  # installed version lacks a transport= kwarg
            pass
    return ONVIFCamera(host, port, username, password)


def _xaddr_host_port(xaddr: str) -> tuple[str, int]:
    """Split an ONVIF xaddr URL into (host, port), defaulting to port 80."""
    parsed = urlparse(xaddr)
    host = parsed.hostname or ""
    port = parsed.port or 80
    return host, port


def discover(timeout: float = 4.0) -> list[dict]:
    """WS-Discovery probe of the LAN for ONVIF cameras.

    Returns a list of ``{"name", "ip", "xaddr", "manufacturer"?, "model"?}``.
    Device name/manufacturer/model are best-effort: they require an
    unauthenticated ONVIF ``GetDeviceInformation``, so when a camera demands
    credentials we return just ``ip``/``xaddr``. Returns ``[]`` (never raises)
    when the ``wsdiscovery`` package isn't installed.
    """
    if not _WSD_OK:
        return []

    wsd = ThreadedWSDiscovery()
    found: list[dict] = []
    try:
        wsd.start()
        services = wsd.searchServices(
            types=[QName(_ONVIF_NS, _ONVIF_TYPE)], timeout=timeout
        )
    except Exception as e:
        print(
            f"  ! ONVIF discovery probe failed: {type(e).__name__}",
            file=sys.stderr,
        )
        try:
            wsd.stop()
        except Exception:
            pass
        return []

    try:
        for svc in services:
            xaddrs = svc.getXAddrs()
            if not xaddrs:
                continue
            xaddr = xaddrs[0]
            host, _ = _xaddr_host_port(xaddr)
            entry: dict = {"name": host, "ip": host, "xaddr": xaddr}
            # Best-effort unauthenticated device info; skip silently on failure.
            info = _device_info(xaddr)
            if info:
                entry.update(info)
                if info.get("model"):
                    entry["name"] = info["model"]
            found.append(entry)
    finally:
        try:
            wsd.stop()
        except Exception:
            pass
    return found


def _device_info(xaddr: str) -> dict | None:
    """Try an unauthenticated GetDeviceInformation; None if it needs creds or
    the onvif package is missing."""
    if not _ONVIF_OK:
        return None
    host, port = _xaddr_host_port(xaddr)
    try:
        with _bounded_socket():
            cam = _make_camera(host, port, "", "")
            info = cam.devicemgmt.GetDeviceInformation()
        return {
            "manufacturer": getattr(info, "Manufacturer", None),
            "model": getattr(info, "Model", None),
        }
    except Exception:
        return None


def resolve_stream(
    xaddr: str, username: str, password: str, profile_index: int = 0
) -> str:
    """Resolve a camera's RTSP stream URL via ONVIF, with credentials embedded.

    Uses ``GetProfiles`` + ``GetStreamUri`` on the media service, then rewrites
    the returned rtsp:// URI to ``rtsp://user:pass@host:port/path`` so it's
    self-contained (the sampler/go2rtc can open it without side-channel creds).

    Raises ``RuntimeError`` if the ``onvif`` package is missing, and lets ONVIF
    client errors (bad creds, unreachable host) propagate to the caller.
    """
    if not _ONVIF_OK:
        raise RuntimeError(
            "ONVIF support unavailable: install the 'onvif-zeep' package"
        )

    host, port = _xaddr_host_port(xaddr)
    # Bound every SOAP call below so a host that accepts TCP but never replies
    # can't wedge the worker (see _ONVIF_TIMEOUT).
    with _bounded_socket():
        cam = _make_camera(host, port, username, password)
        media = cam.create_media_service()

        profiles = media.GetProfiles()
        if not profiles:
            raise RuntimeError("camera returned no media profiles")
        idx = profile_index if 0 <= profile_index < len(profiles) else 0
        token = profiles[idx].token

        req = media.create_type("GetStreamUri")
        req.ProfileToken = token
        req.StreamSetup = {
            "Stream": "RTP-Unicast",
            "Transport": {"Protocol": "RTSP"},
        }
        uri = media.GetStreamUri(req).Uri
    return _embed_credentials(uri, username, password)


def _embed_credentials(uri: str, username: str, password: str) -> str:
    """Return `uri` with `user:pass@` injected into its authority component."""
    if not username:
        return uri
    parsed = urlparse(uri)
    host = parsed.hostname or ""
    if not host:  # no authority to inject into (e.g. a relative/opaque URI)
        return uri
    if ":" in host:  # IPv6 literal — urlparse strips the [...], re-wrap it
        host = f"[{host}]"
    userinfo = f"{quote_cred(username)}:{quote_cred(password)}@" if password else (
        f"{quote_cred(username)}@"
    )
    netloc = userinfo + host
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


def quote_cred(value: str) -> str:
    """Percent-encode a username/password so it's safe inside a URL authority."""
    from urllib.parse import quote

    return quote(value, safe="")
