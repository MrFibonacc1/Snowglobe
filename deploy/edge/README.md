# Snowglobe edge agent

The piece that runs **inside the shop**: a camera gateway (go2rtc) plus the
perception sampler. Video stays on the LAN; only event JSON is POSTed to the
cloud automation service. See [`../../docs/CAMERA_INTEGRATION.md`](../../docs/CAMERA_INTEGRATION.md)
for the full architecture.

## Run it

1. **Start the gateway** (Docker):

   ```sh
   cd deploy/edge
   docker compose up -d          # go2rtc on :1984 (API) and :8554 (RTSP)
   ```

2. **Start perception**, pointed at the gateway and your cloud automation:

   ```sh
   GO2RTC_URL=http://localhost:1984 \
   GO2RTC_RTSP=rtsp://localhost:8554 \
   AUTOMATION_URL=https://<your-cloud>/ \
   NVIDIA_API_KEY=nvapi-... \
   python -m perception.server           # :8008
   ```

3. **Connect cameras** from the dashboard's Cameras page:
   - **Scan network** → pick a discovered ONVIF camera → enter its credentials, or
   - paste an `rtsp://` URL directly.

   Either way the camera is registered in go2rtc and sampled from the
   normalized `rtsp://localhost:8554/<name>` stream.

## Why go2rtc

One gateway speaks every protocol a shop camera might use: RTSP/ONVIF
(Hikvision, Dahua, Amcrest, Reolink, NVR kits) plus vendor-native bridges for
Wyze, Nest, Ring, TP-Link. It re-streams them all as plain RTSP, so perception
never has to learn a vendor SDK.

## Pinning cameras

Cameras added from the dashboard are ephemeral (in go2rtc's runtime state). To
pin cameras across restarts, add them under `streams:` in `go2rtc.yaml`.

## Notes

- `network_mode: host` is required for ONVIF WS-Discovery and to reach cameras
  on the local subnet.
- The gateway needs outbound internet only for the hosted Cosmos/NIM calls and
  to POST events, with no inbound ports.
