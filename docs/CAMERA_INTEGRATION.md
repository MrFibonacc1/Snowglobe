# Camera Integration Plan

How Snowglobe connects to the cameras real small businesses actually have.

## TL;DR

**Don't integrate by brand — integrate by protocol.** Put a universal gateway
(**go2rtc**) plus **ONVIF auto-discovery** in front of the perception service.
That covers the large majority of real shop cameras with almost no change to
`perception/capture.py` — it already speaks RTSP, and go2rtc normalizes
everything to RTSP.

## What's actually in SF mom-and-pop shops

Two tiers, and the split drives the whole design.

| Tier | Brands you'll find | Who buys it | ONVIF/RTSP? |
|---|---|---|---|
| **Installed DVR/NVR** (majority) | **Hikvision, Dahua**, and OEM rebrands: **Amcrest** (=Dahua), **Lorex** (=Dahua '18–'22), **Annke/LTS/LaView** (=Hikvision), **Reolink** | Bodega / liquor store / restaurant with a local-installer or Costco/Amazon kit. Hikvision+Dahua ≈ 40% of the global market and dominate SMB volume. | **Yes** — native ONVIF + RTSP (exception: *recent* Lorex firmware dropped it) |
| **Cheap consumer cloud** | **Wyze, Ring, Nest, Blink, Eufy** | Café / tiny shop, single camera off a shelf. Cloud-locked by design. | **Mostly no** — Wyze RTSP is beta/pulled; Ring none official; Nest only via Google SDM |

~80% of real installs speak **ONVIF + RTSP** regardless of the logo. Verkada is
SF-based but enterprise-priced — not mom-and-pop; skip for MVP.

## Integration strategy: go2rtc as a universal gateway

[go2rtc](https://github.com/AlexxIT/go2rtc) ingests basically anything a shop
could have and **re-streams it all as normalized RTSP**:

- Direct: RTSP, ONVIF, RTMP, DVRIP, HTTP/MJPEG, USB
- Vendor-native (no SDK work on our side): isapi (Hikvision), Dahua, Nest,
  Ring, Wyze, TP-Link tapo/vigi/kasa, Reolink

Every camera is registered in go2rtc; the sampler only ever sees one thing:
`rtsp://<gateway>:8554/<name>`. On top, **ONVIF WS-Discovery** lets a
non-technical owner "Scan for cameras" instead of typing an RTSP URL, with
paste-a-URL as the always-works fallback.

## Architecture (decision: edge-agent)

Shop cameras live on a LAN behind NAT and the footage is private. Perception
runs **at the edge** (a box in the shop — for the hackathon, the dev laptop
*is* that box); only tiny JSON events leave the building.

```
┌───────────────── SHOP LAN (private) ─────────────────┐
│  Hikvision/Dahua/Amcrest/Reolink ──ONVIF/RTSP─┐       │
│  Wyze / Nest / Ring ──vendor-native───────────┤       │
│  USB / analog+DVR ────────────────────────────┤       │
│                                                ▼       │
│                                        ┌────────────┐  │
│                                        │  go2rtc    │  │  universal gateway
│                                        └─────┬──────┘  │  → normalized RTSP
│                                              ▼         │
│                                   ┌────────────────┐   │
│                                   │ perception/     │  │  EDGE AGENT
│                                   │ capture.py +    │  │  (laptop / mini-PC)
│                                   │ Cosmos via NIM  │  │  sampler @ 0.3 fps
│                                   └────────┬───────┘   │
│                                    events (JSON only)  │
└──────────────────────────────────────────┼────────────┘
                            HTTPS POST /events (outbound only, no inbound ports)
                                            ▼
                          ┌───────────────────────────┐
                          │ automation/ (cloud)        │  unchanged
                          │ workflow engine + dashboard│
                          └───────────────────────────┘
```

**Why:** video never leaves the shop (privacy + bandwidth); no inbound firewall
rules (the agent dials out); go2rtc absorbs all vendor weirdness so our code
stays protocol-clean.

## Code changes (small)

| Component | Change |
|---|---|
| `perception/capture.py` | Already takes `rtsp://`. Point `source` at a go2rtc stream. ~0 change. |
| `perception/gateway.py` (new) | go2rtc REST client: register/unregister a stream, build the normalized RTSP URL. Best-effort — falls back to direct RTSP if go2rtc is down. |
| `perception/onvif.py` (new) | WS-Discovery + `GetStreamUri`. Guarded imports so the server boots without the optional deps. |
| `perception/server.py` | `POST /cameras` gains `use_gateway`; add `GET /discover` and `POST /discover/resolve`. |
| `dashboard` Cameras page | "Scan network" → pick camera → credentials → Connect. Manual RTSP paste kept as fallback. |
| `deploy/edge/` (new) | go2rtc compose + sample config + README — the edge-agent bundle. |

## Demo cameras (cheapest → most realistic)

1. **Phone as RTSP** — the *IP Webcam* (Android) app streams `rtsp://` / MJPEG. Free, instant.
2. **Webcam** — already supported (`--source webcam`). Always-works fallback.
3. **~$40 Amcrest or Reolink** — real ONVIF/RTSP hardware that matches what shops run.

## Phased plan

- **Phase 0 — validate RTSP direct.** One real ONVIF cam → confirm the full loop on a live feed (the end-to-end smoke test).
- **Phase 1 — go2rtc gateway + ONVIF onboarding.** *(this change)* Any ONVIF/Hikvision/Dahua/Reolink cam connects without a URL.
- **Phase 2 — edge-agent packaging.** Compose bundle for a mini-PC/Pi; auto-registers with cloud automation; phones home events.
- **Phase 3 — cloud-cam bridges.** Wyze/Nest/Ring via go2rtc + a credential vault. Lower priority (flaky, smaller share).

## Risks / caveats

- **Recent Lorex + all Wyze/Ring/Nest are cloud-locked.** Bridges exist but are fragile (Wyze pulled RTSP firmware and throttled bridges in 2025). ONVIF tier is rock-solid; consumer-cloud tier is best-effort.
- **Cosmos at the edge** — a Pi can't run the reasoner; the edge box calls the hosted NIM endpoint (needs outbound internet, which it has). At 0.3 fps this is cheap.
- **Credentials** — RTSP passwords need a real secret store even in MVP.
- **ONVIF discovery is LAN-scoped** — an edge-agent feature, not a cloud one.
