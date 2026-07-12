# automation

Events in → workflow engine → actions. Implemented and working.

FastAPI service: `POST /events` + workflow/run CRUD (the API the dashboard's
workflow builder talks to). The trigger matcher (event type + zone +
confidence + per-(workflow, zone) cooldown) starts async runs; the engine
executes steps sequentially with `{{event.*}}` templating and persists
per-step status live:

- **h_agent**: H Company hosted Agent API (or mock). Real modes fail closed unless the agent reaches a terminal state with a usable answer; dependent steps are skipped on timeout. See [NOTES.md](NOTES.md).
- **composio**: Slack / Drive / Sheets via Composio SDK; fails unless execution is confirmed. See [NOTES.md](NOTES.md).
- **condition**: gate on event payload, e.g. `payload.count > 20`.
- **inventory_adjust**: idempotent persisted stock changes with before/after counts.

H Agent polling performs one final bounded session refresh at the configured
time-budget boundary. This recovers answers that complete between scheduled
polls while still failing closed when the session remains active or terminal
without a usable answer.
- **voice**: fail-closed Gradium TTS; stores confirmed audio output.

Contracts: [../shared/event_schema.json](../shared/event_schema.json),
[../shared/workflow_schema.json](../shared/workflow_schema.json). Two demo
workflows are seeded on first boot.

## Quickstart

```bash
cd automation
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8000 --reload
```

Then in another terminal:

```bash
.venv/bin/python send_event.py spill --zone zone_b
curl -s localhost:8000/runs | python3 -m json.tool   # watch steps progress
```

No API keys are needed to develop the engine, but Composio steps fail closed
until real execution is configured. To go real, follow [NOTES.md](NOTES.md).

## Layout

```
main.py            # FastAPI app + routes
engine.py          # matching, cooldown, templating, run execution
storage.py         # SQLite (events / workflows / runs as JSON rows)
seeds.py           # demo workflows seeded on first boot
steps/             # h_agent, composio_step, condition, voice executors
send_event.py      # dev tool: post schema-valid events
NOTES.md           # H Company + Composio integration handbook
```
