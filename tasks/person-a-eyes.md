# Task brief — Person A: "Eyes" (perception)

Build `perception/`: a Python service that turns video into schema-valid
events. Read [PLAN.md](../PLAN.md) §Architecture and [CLAUDE.md](../CLAUDE.md)
first.

## Goal

`video source → 1 fps frames → Cosmos 3 Reasoner (NVIDIA NIM API) → events →
POST http://localhost:8000/events`

Events MUST validate against [shared/event_schema.json](../shared/event_schema.json).

## Deliverables

1. **Frame sampler** (`perception/sampler.py`): OpenCV capture from
   `--source webcam|<rtsp-url>|<file-path>`, sample ~1 fps, save each frame
   as JPEG to `snapshots/` with a timestamped name.
2. **NIM client** (`perception/vlm.py`): send a frame + prompt to the
   **Cosmos 3 Reasoner** via the NIM API (`NVIDIA_API_KEY` env var) —
   default model `cosmos3-nano-reasoner` on build.nvidia.com; upgrade to
   Cosmos 3 Super's reasoner if NVIDIA mentors give us datacenter GPU
   access; Nemotron VL as fallback. Request JSON-only output and parse
   defensively — reasoning models wrap answers in `<think>…</think>` blocks,
   so strip those before extracting the JSON verdict.
3. **Prompt library** (`perception/prompts.py`): one prompt per event type —
   `spill`, `person_count`, `foot_traffic`, `safety_violation`. Each prompt
   asks for a JSON verdict: `{"detected": bool, "confidence": 0-1, "count": int?, "detail": str?}`.
4. **Event emitter** (`perception/emit.py` + `__main__.py`): normalize VLM
   verdicts into the event schema (uuid, ISO timestamp, zone from `--zone`
   flag, `snapshot_url` = local path or `http://localhost:8001/snapshots/…`
   if you add a tiny static server), then POST to the automation service.
   `--dump events.jsonl` writes JSONL instead of POSTing.
5. **Demo clips**: record/collect 3 short clips into `demo/` (staged water
   spill, several people walking, person without hard hat). Tune prompts
   against these cached frames, not live camera (free iteration, no rate
   limits).

## Interfaces

- **Produces:** `POST /events` (automation service, port 8000). If it's not
  up yet, use `--dump`.
- **Consumes:** nothing from teammates.

## Acceptance

- `python -m perception --source demo/spill.mp4 --zone zone_b --dump out.jsonl`
  → schema-valid spill events with sensible confidence, snapshot files exist.
- Same command without `--dump` while automation runs → events appear in
  `GET /events`.
- False-positive sanity: pointing at a clean floor produces no spill events.
