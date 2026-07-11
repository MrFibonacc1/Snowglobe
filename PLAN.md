# palantirV2 — Project Plan (v2, 3-person split)

**Ambient perception → agentic action.** Cameras watch a physical space.
**NVIDIA Cosmos 3's Reasoner** (Super where we have the compute, Nano via the
hosted NIM endpoint otherwise) turns frames into structured events — spills,
occupancy, foot traffic, safety violations. Those events flow into our
**own workflow builder**: users visually compose automations whose steps are
**H Company agent** runs (fill a Google Form, create a ticket — orchestrated
through **OpenClaw**) and **Composio** actions (Drive, Sheets, Slack). A live
dashboard shows everything happening.

Built at The Computer Use Hackathon (H Company / NVIDIA / Accel), Jul 11–12 2026, SF.

## Stack at a glance

| Layer | Tech | Role |
|---|---|---|
| Perception | **NVIDIA Cosmos 3 Reasoner** via NIM API (`cosmos3-nano-reasoner` hosted on build.nvidia.com; Super's 32B reasoner if we get datacenter GPU access; Nemotron VL as fallback) | Frames → detections (one prompt per event type) |
| Events | Our JSON schema over HTTP | The contract between all parts |
| Workflow engine | **Custom** — FastAPI backend | Trigger matching, step execution, run logs |
| Workflow builder UI | Our dashboard (React/Vite, built) | Visual editor: trigger + ordered action steps |
| Agent orchestration | **OpenClaw** driving **H Company agents** (credits in hand) | UI work: Google Forms, ticket builders, portals |
| Integrations | **Composio** | API work: Drive, Sheets, Slack |
| Voice (stretch) | Gradium | Spoken alerts, targets Gradium Challenge |

## Architecture

```
 video (webcam / RTSP / clip)
        │
        ▼
 ┌──────────────────┐  1 fps   ┌───────────────────────────┐
 │   perception/     │ ───────▶ │ NVIDIA Cosmos 3 Reasoner   │
 │   frame sampler   │          │ (Super/Nano via NIM API)   │
 └──────────────────┘          └────────────┬───────────────┘
                                            │ detections
                                            ▼
                                 ┌───────────────────────────┐
                                 │ event normalizer           │
                                 │ → shared/event_schema.json │
                                 └────────────┬───────────────┘
                                              │ POST /events
                                              ▼
 ┌───────────────────────────── automation/ ──────────────────────────────┐
 │                                                                         │
 │  trigger matcher (event type + zone + confidence + cooldown/dedup)      │
 │        │ matched                                                        │
 │        ▼                                                                │
 │  WORKFLOW ENGINE — executes the workflow's steps in order,              │
 │  records a Run with per-step status                                     │
 │        │                                                                │
 │        ├─ h_agent step ──▶ OpenClaw ──▶ H Company agent                 │
 │        │                   (session mgmt, retries, replay capture)      │
 │        │                   → fills Google Form / creates ticket / UI    │
 │        ├─ composio step ─▶ Drive upload · Sheets append · Slack msg     │
 │        ├─ condition step ─▶ e.g. only if payload.count > 20             │
 │        └─ voice step (stretch) ─▶ Gradium spoken alert                  │
 │                                                                         │
 │  REST API: /events /workflows /runs  ◀──────────────┐                   │
 └─────────────────────────────────────────────────────┼───────────────────┘
                                                       │ poll
                                              ┌────────┴────────┐
                                              │   dashboard/     │
                                              │ cameras · integr.│
                                              │ WORKFLOW BUILDER │
                                              │ live runs view   │
                                              └─────────────────┘
```

## Repo layout

```
palantirV2/
  perception/    # Python: sampler → Cosmos 3 Reasoner → events           (Person A)
  automation/    # Python/FastAPI: workflow engine + OpenClaw + Composio  (Person B)
  dashboard/     # React: console + workflow builder UI  [BUILT — extend] (Person C)
  shared/        # event_schema.json + workflow_schema.json — the contracts
  demo/          # clips, fake-event scripts, pitch assets
```

## Data contracts (freeze by hour 2)

**Event** — already frozen, see [shared/event_schema.json](shared/event_schema.json).

**Workflow** — what the builder UI edits and the engine executes:

```json
{
  "id": "wf_spill_incident",
  "name": "Spill → incident report",
  "enabled": true,
  "trigger": {
    "event_type": "spill",
    "zone": "zone_b",
    "min_confidence": 0.7,
    "cooldown_sec": 300
  },
  "steps": [
    { "id": "s1", "type": "h_agent",  "config": { "task": "google_form",
        "url": "https://forms.gle/…",
        "instructions": "Fill the incident form: location={{event.location}}, time={{event.timestamp}}, description={{event.payload.detail}}. Attach {{event.snapshot_url}}. Submit." } },
    { "id": "s2", "type": "composio", "config": { "action": "drive_upload",
        "file": "{{event.snapshot_url}}", "folder": "incidents/" } },
    { "id": "s3", "type": "composio", "config": { "action": "slack_message",
        "channel": "#facilities-alerts",
        "text": "🚨 {{event.event_type}} in {{event.location}} ({{event.confidence}})" } }
  ]
}
```

- `zone` is optional (omit = any zone). `cooldown_sec` dedups: one run per
  (workflow, zone) per window — a spill at 1 fps must fire once, not thirty times.
- `{{event.*}}` templating is resolved by the engine before each step runs.
- Steps execute sequentially; a failed step marks the run failed (no retries
  in v1 except inside OpenClaw for agent runs).

**Run** — one execution of a workflow, what the dashboard's live view polls:

```json
{
  "id": "run_abc",
  "workflow_id": "wf_spill_incident",
  "event": { "…triggering event…" },
  "status": "running | done | failed",
  "steps": [
    { "id": "s1", "status": "done",    "started_at": "…", "output": { "replay_url": "…" } },
    { "id": "s2", "status": "running", "started_at": "…" },
    { "id": "s3", "status": "pending" }
  ]
}
```

**Automation service REST API** (dashboard ↔ backend contract):

| Endpoint | Purpose |
|---|---|
| `POST /events` | perception (or fake script) submits events |
| `GET /events?limit=N` | dashboard event feed |
| `GET/POST/PUT/DELETE /workflows` | builder CRUD |
| `GET /runs?limit=N`, `GET /runs/{id}` | live runs view |
| `POST /workflows/{id}/test` | fire a synthetic event at one workflow (demo + dev) |

## Step types (v1)

| Type | Executor | Config | Notes |
|---|---|---|---|
| `h_agent` | OpenClaw → H Company agent | task kind (google_form / ticket / custom_url), url, templated instructions | The judged capability. Capture replay/screenshots into run output |
| `composio` | Composio SDK | action (drive_upload, sheets_append, slack_message), templated params | API-shaped work stays here — don't waste agent runs on it |
| `condition` | engine built-in | expression on event payload, e.g. `payload.count > 20` | Stops the run quietly if false |
| `voice` (stretch) | Gradium API | templated text to speak | Gradium Challenge |

## Work split — 3 people

### Person A — "Eyes" (perception, Python/CV)

1. Frame sampler: OpenCV capture from webcam / RTSP / video file at ~1 fps,
   selected with a `--source` flag. Save each sampled frame to `snapshots/`
   (served via a static route so `snapshot_url` resolves).
2. NIM client: call the **Cosmos 3 Reasoner** with one prompt per event type;
   force JSON output; parse and validate against the event schema.
   - Model choice: `cosmos3-nano-reasoner` (hosted NIM on build.nvidia.com)
     is the default; upgrade to **Cosmos 3 Super**'s 32B reasoner if NVIDIA
     gives us datacenter GPU access at the event (ask their mentors — Super
     needs Hopper/Blackwell; Nano runs on workstation GPUs). Nemotron VL is
     the fallback if Cosmos endpoints rate-limit.
   - Why Cosmos over a generic VLM: it's post-trained for physical-world
     video reasoning — timestamped event localization, bounding-box
     grounding, physical common sense — and leads the smart-space benchmarks.
     Exactly our spill/PPE/crowd problem, and the strongest NVIDIA
     Challenge story.
3. Prompt library: spill, person_count, foot_traffic (counts over a window),
   safety_violation (PPE / blocked exit). Tune on saved demo clips, not the
   live camera — cached frames make iteration free.
4. Event emitter: `POST /events`, plus a `--dump` mode (write JSONL to a file)
   so A never blocks on B.
5. Record 3–4 demo clips (staged water spill, crowd walk-through,
   missing-hard-hat) and calibrate per-event-type confidence on them.
6. Stretch: local YOLO overlay for bounding-box visuals in the dashboard.

### Person B — "Brain" (automation backend, Python/FastAPI)

1. **Hour-0 spike (highest risk first):** using our existing credits, drive
   one H Company agent run through OpenClaw that fills a throwaway Google
   Form. Nothing else matters until this works once.
2. FastAPI service: `POST /events`, SQLite (or JSON-file) persistence for
   events, workflows, runs.
3. Trigger matcher with per-(workflow, zone) cooldown.
4. Workflow engine: sequential step executor, `{{event.*}}` templating,
   run + per-step status persistence, async execution (runs must never block
   event ingestion).
5. Step executors: `h_agent` (via OpenClaw — session lifecycle, retry once,
   capture replay URL/screenshots into run output), `composio` (Drive,
   Sheets, Slack), `condition`.
6. `send_fake_event.py` + seeded workflows so B and C never block on A.
7. Stretch: `voice` step via Gradium.

### Person C — "Face" (dashboard + demo, React/TS)

The dashboard already exists (cameras, integrations, automations, event log,
live feed — see [dashboard/README.md](dashboard/README.md)). C upgrades it
from mock-backed to real and turns the Automations page into the builder:

1. **Workflow builder UI**: trigger panel (event type, zone, confidence,
   cooldown) + ordered step list — add/remove/reorder steps, per-type config
   forms (h_agent: task kind, URL, instructions textarea with `{{event.*}}`
   hints; composio: action picker + params; condition: expression).
   Canvas/drag-drop is a nice-to-have; a list-based editor is enough to win.
2. **Live runs view**: per-run timeline showing each step pending → running →
   done, with agent replay links/screenshots from run output. This is the
   demo money shot.
3. Wire pages to the real API (`/workflows`, `/runs`, `/events`), keeping the
   existing localStorage/simulation as offline fallback.
4. Camera page: show latest snapshot per camera (from perception's frames).
5. Demo ownership: rehearse the flow, record fallback videos of successful
   runs, build the 90-second pitch and deck.

### Sync points (whole team)

| When | Checkpoint |
|---|---|
| Hr 2 | Contracts frozen: workflow + run schemas agreed, `POST /events` live |
| Hr 6 | Fake spill event → workflow run → Slack message fires; runs visible in dashboard |
| Hr 10 | **H agent fills the Google Form end-to-end from a fake event** — replay visible in runs view |
| Hr 16 | Real camera → real event → full run. First true end-to-end |
| Hr 24 | All 4 event types working; builder can create a new workflow from scratch live |
| Hr 34 | Feature freeze. Record fallback demo videos, rehearse twice |

## Demo script (90 seconds)

1. Dashboard on screen: two cameras live, event feed streaming.
2. Presenter pours water on the floor in front of the webcam.
3. Spill event appears in the feed → a run starts in the live runs view.
4. Screen shows the H agent (via OpenClaw replay) filling the facilities
   Google Form field by field, attaching the snapshot, submitting.
5. Slack alert pops, Drive folder shows the snapshot, sheet gets a row.
6. Kicker: open the workflow builder and, live, add a "safety violation →
   create ticket" workflow in ~20 seconds, then trigger it with a clip.
   *"Anyone can wire the physical world to any software — no code."*

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| H agent API surprises | Person B's hour-0 spike; mentors on site; OpenClaw retry + recorded replays as stage fallback |
| Agent slow/flaky live | Play a recorded successful replay while the live run executes |
| Event spam (1 fps) | `cooldown_sec` per workflow from day one |
| NIM rate limits / credits | Tune prompts on saved clips (cached responses), 1 fps sampling |
| Builder UI scope creep | List-based steps, not canvas; drag-drop only if hours remain |
| Team blocking on each other | Contracts by hr 2; fakes on every boundary (`--dump`, `send_fake_event.py`, dashboard simulation) |

## Prize alignment

- **Main (H Company):** agents doing visible multi-step UI work, composable
  by end users in a workflow builder — a genuinely new interface to their tech.
- **NVIDIA Challenge:** Cosmos 3 Reasoner (their flagship physical-AI model,
  released June 2026) is the entire perception layer — used for exactly the
  smart-space workload it was built for.
- **Gradium Challenge:** voice step in the builder (stretch).
