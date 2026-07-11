# Task brief — Person B: "Brain" (automation backend)

Build `automation/`: the FastAPI service with the workflow engine. Read
[PLAN.md](../PLAN.md) §Data contracts and §Step types, and
[CLAUDE.md](../CLAUDE.md) first.

## Do this FIRST (hour-0 spike, highest risk)

Before any FastAPI code: using our H Company credits, drive ONE agent run
through OpenClaw that fills a throwaway Google Form (make one with 3 fields).
Capture whatever run/replay artifact the API returns. Everything else in this
brief is worthless until this works once. Write findings (endpoint shapes,
auth, latency, replay URL format) into `automation/NOTES.md` for the team.

## Deliverables

1. **FastAPI service** (`automation/main.py`, port 8000, permissive CORS):
   - `POST /events` — validate against `shared/event_schema.json`, persist,
     hand to trigger matcher. Return 202 immediately (runs are async).
   - `GET /events?limit=N` — newest first.
   - `GET/POST/PUT/DELETE /workflows` — validate against
     `shared/workflow_schema.json`.
   - `GET /runs?limit=N`, `GET /runs/{id}` — run objects per PLAN.md §Run.
   - `POST /workflows/{id}/test` — fire a synthetic event at one workflow.
   - Persistence: SQLite via `sqlite3`/`aiosqlite`, or JSON files — whichever
     is fastest for you. This is a hackathon.
2. **Trigger matcher**: event matches workflow if enabled + event_type equals
   + (no zone or zone equals) + confidence ≥ min. **Cooldown**: at most one
   run per (workflow_id, event.location) per `cooldown_sec` — this is what
   stops 1 fps frames from firing 30 duplicate runs.
3. **Workflow engine**: async task per run; resolve `{{event.*}}` templates
   in all step config strings; execute steps sequentially; update per-step
   status (`pending → running → done|failed`) in storage as it goes (the
   dashboard polls this live); failed step → run failed, skip rest.
4. **Step executors** (`automation/steps/`):
   - `h_agent`: dispatch through OpenClaw to the H agent using hour-0
     findings; config = `{task, url, instructions}`; retry once on failure;
     store replay URL / screenshots in step output.
   - `composio`: `drive_upload`, `sheets_append`, `slack_message` via
     Composio SDK (`COMPOSIO_API_KEY`). If an account isn't connected yet,
     log the payload and mark the step done with `{"stubbed": true}` so
     demos never hard-block.
   - `condition`: safe-eval a simple expression against the event
     (`payload.count > 20`) — no `eval()` on raw strings; a tiny parser or
     restricted namespace.
5. **Dev tooling**: `send_fake_event.py <event_type> [--zone z]` posting
   schema-valid events, and 2 seeded workflows on first boot (spill→incident,
   person_count→occupancy) so the dashboard has real data immediately.

## Interfaces

- **Consumes:** events from Person A (or your fake script).
- **Produces:** the REST API Person C's dashboard polls. API shapes are in
  PLAN.md — if you must deviate, tell Person C immediately.

## Acceptance

- `uvicorn automation.main:app` then `python send_fake_event.py spill --zone zone_b`
  → `GET /runs` shows a run whose steps progress to done; Slack message
  arrives (or stub logged); h_agent step output contains a replay reference.
- Two identical spill events 5s apart → exactly one run (cooldown works).
- `POST /workflows` with an invalid body → 422, with a valid body → shows up
  in `GET /workflows` and can be triggered via `/test`.
