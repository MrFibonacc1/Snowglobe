# perception

Video in → NeMo VLM detections → events out.

Samples frames (~1 fps) from a webcam or clip, sends each to Nemotron VL via
NVIDIA NIM with one prompt per event type, normalizes responses into the
[shared event schema](../shared/event_schema.json), and POSTs them to
`automation/`'s `/events` endpoint.

Dev mode: `--dump` writes events to a file instead of POSTing, so this side
runs standalone.
