# automation

Events in → workflow engine → actions. **Implemented and working.**

FastAPI service: `POST /events` + workflow/run CRUD (the API the dashboard's
workflow builder talks to). The trigger matcher (event type + zone +
confidence + per-(workflow, zone) cooldown) starts async runs; the engine
executes steps sequentially with `{{event.*}}` templating and persists
per-step status live:

- **h_agent** — H Company agent via surfer-h-cli (or mock). See [NOTES.md](NOTES.md).
- **composio** — Slack / Drive / Sheets via Composio SDK (or stub). See [NOTES.md](NOTES.md).
- **condition** — gate on event payload, e.g. `payload.count > 20`.
- **voice** — Gradium stretch (stub).

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
.venv/bin/python send_fake_event.py spill --zone zone_b
curl -s localhost:8000/runs | python3 -m json.tool   # watch steps progress
```

No API keys needed — h_agent mocks and composio stubs. To go real, follow
[NOTES.md](NOTES.md).

## Layout

```
main.py            # FastAPI app + routes
engine.py          # matching, cooldown, templating, run execution
storage.py         # SQLite (events / workflows / runs as JSON rows)
seeds.py           # demo workflows seeded on first boot
steps/             # h_agent, composio_step, condition, voice executors
send_fake_event.py # dev tool: post schema-valid events
NOTES.md           # H Company + Composio integration handbook
```
