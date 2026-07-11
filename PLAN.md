# palantirV2 — Project Plan

**Ambient perception → agentic action.** A camera watches a physical space; a
vision pipeline turns what it sees into structured events (spill, occupancy,
foot traffic, safety violation); an automation layer reacts by driving real
software — H Company's computer-use agent fills forms and navigates UIs,
Composio handles SaaS integrations (Drive, Sheets, Slack).

Built at The Computer Use Hackathon (H Company / NVIDIA / Accel), Jul 11–12 2026, SF.

---

## Architecture

```
 video (webcam or clip)
        │
        ▼
 ┌─────────────────┐   1 frame/sec    ┌──────────────────────────┐
 │   perception/    │ ───────────────▶ │  NVIDIA NeMo (Nemotron   │
 │  frame sampler   │                  │  VL via NIM API)         │
 └─────────────────┘                  └──────────┬───────────────┘
                                                 │ detections
                                                 ▼
                                      ┌──────────────────────────┐
                                      │  event normalizer         │
                                      │  → shared event schema    │
                                      └──────────┬───────────────┘
                                                 │ HTTP POST /events
                                                 ▼
 ┌────────────────────────────────────────────────────────────────┐
 │                        automation/                              │
 │  trigger engine (dedup, cooldown, thresholds)                   │
 │       │                                                         │
 │       ├── H Company agent: UI tasks (fill incident form,        │
 │       │   raise safety ticket, navigate portals)                │
 │       └── Composio: Drive upload, Sheets append, Slack notify   │
 └──────────────────────────────┬─────────────────────────────────┘
                                │ event + action log
                                ▼
                        ┌───────────────┐
                        │   dashboard/   │  live event feed +
                        └───────────────┘  "agent working on X"
```

**The contract between the two halves is the event schema**
([shared/event_schema.json](shared/event_schema.json)). Perception and
automation are independently runnable services — no imports across the
boundary, each side has a fake for the other (`perception` can dump events to
a file; `automation` has a fake-event sender script).

## Repo layout

```
palantirV2/
  perception/    # video in → NeMo VLM detections → events out (Python)
  automation/    # events in → triggers → H Company agent + Composio (Python, FastAPI)
  dashboard/     # live event feed + agent activity (simple web UI)
  shared/        # event_schema.json — the one contract, frozen early
  demo/          # pre-recorded clips, seeded data, run scripts
```

## Event schema (v1 — freeze in hour one)

```json
{
  "event_id": "uuid",
  "event_type": "spill | person_count | foot_traffic | safety_violation",
  "timestamp": "ISO-8601",
  "confidence": 0.92,
  "location": "zone_a",
  "snapshot_url": "path-or-url-to-frame",
  "payload": { "count": 14, "detail": "free-form per event type" }
}
```

Adding a new event type = a new VLM prompt in perception + a new recipe in
automation. No pipeline changes.

## The four demo flows (priority order)

| # | Flow | Trigger | Automation | Tier |
|---|------|---------|-----------|------|
| 1 | **Spill → incident report** | VLM flags liquid on floor | H agent opens facilities incident form, fills it, attaches snapshot; Composio files photo + row to Drive/Sheets | **Core** — build first, end to end |
| 2 | **People count → occupancy** | Count crosses capacity threshold | Composio appends to occupancy sheet, Slack alert; H agent updates occupancy portal | Second |
| 3 | **Safety/PPE check** | Missing hard-hat / blocked exit | H agent raises a safety ticket with evidence | Third — reuses flow 1's machinery |
| 4 | **Foot traffic → analytics** | Zone counts aggregated over time | Periodic report generated, dropped into Drive; dashboard heatmap | Stretch — it's aggregation over events we already emit |

Flow 1 is the demo centerpiece: it shows the agent doing visible, multi-step
UI work that a plain webhook can't. Flows 2–4 mostly reuse the same pipeline
with new prompts/recipes — that's the point of the architecture.

## Tech choices

- **Perception:** Python. Sample frames at ~1 fps, send to **Nemotron VL via
  NVIDIA NIM API** (build.nvidia.com / hackathon credits) with one prompt per
  event type ("Is there a liquid spill on the floor? Answer JSON…", "How many
  people are visible?…"). One code path for all four event types.
  - Why VLM over YOLO: no pretrained spill/PPE model exists worth fine-tuning
    in 48h, and a prompt is a config change, not a training run. Using NeMo
    end-to-end also targets the **NVIDIA Challenge** (RTX 5080).
  - Stretch: local GPU YOLO for smooth bounding-box visuals in the dashboard.
- **Automation:** Python + FastAPI service exposing `POST /events`. Trigger
  engine with per-(zone, event_type) **cooldown/dedup** — one spill must fire
  one incident, not thirty (frames arrive every second).
  - **H Company agent API** (Runner H / Surfer H) for anything that needs UI
    navigation — that's the hackathon's judged capability, keep it front and
    center.
  - **Composio** for API-shaped work (Drive, Sheets, Slack). Don't route
    API-shaped work through the computer-use agent; judges will ask why.
- **Dashboard:** simplest thing that looks alive — single-page app polling the
  automation service: event feed, latest snapshot, agent run status/replays.
- **Gradium stretch:** spoken alerts ("Spill detected in zone A") via Gradium
  voice API — cheap add, targets the Gradium Challenge credits.

## 48-hour timeline

**Sat morning (hrs 0–4)**
- Freeze event schema. Scaffold both services + fake-event sender.
- Perception: webcam/clip → frame sampler → one NeMo VLM call working.
- Automation: `POST /events` receiving fake events, logging them.

**Sat afternoon (hrs 4–10)**
- Flow 1 end to end with FAKE events: trigger engine → H agent fills incident
  form → Composio files to Drive. This is the riskiest integration; do it first.
- Perception: spill + person_count prompts returning schema-valid events.

**Sat evening/night (hrs 10–18)**
- Connect real perception → automation. First true end-to-end run.
- Dashboard v1 (event feed + agent status). Flow 2 recipes.
- Record clean demo clips of every working flow as you go (agent runs are
  flaky; a recorded successful run is your safety net).

**Sun morning (hrs 18–30)**
- Flows 3 and 4. Dedup/cooldown tuning. Dashboard polish.
- Gradium voice alerts if time allows.

**Sun afternoon (hrs 30–40)**
- Feature freeze. Pre-record fallback demo videos (spill clip, crowd clip,
  PPE clip). Rehearse the live demo path twice. Pitch deck / story.

## Team split (3–5 people)

- **1–2 × Perception:** frame pipeline, NeMo prompts, event emission.
- **1–2 × Automation:** trigger engine, H Company agent recipes, Composio.
- **1 × Dashboard + demo:** UI, demo clips, pitch, integration glue.

Both subteams work against fakes from hour one; integration is continuous,
not a Sunday event.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Live camera demo dies (lighting, lag) | Pre-recorded clips as primary demo, live webcam as flourish |
| H agent runs are slow/flaky on stage | Record successful runs; show recording while a live run executes |
| Event spam (1 fps → 30 identical events) | Cooldown/dedup in trigger engine from day one |
| NIM API rate limits / credits | Cache VLM responses per clip during dev; sample at 1 fps, not 30 |
| Four flows = scope creep | Tiered priorities; flow 1 must be perfect, 4 is a stretch |

## Prize alignment

- **Main (H Company):** computer-use agent doing visible multi-step UI work,
  triggered by the real world — not a chatbot wrapper.
- **NVIDIA Challenge:** NeMo/Nemotron VL powers the entire perception layer.
- **Gradium Challenge:** voice alerts stretch goal.
