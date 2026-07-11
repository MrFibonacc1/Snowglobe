# automation

Events in → workflow engine → actions.

FastAPI service exposing `POST /events` plus CRUD for workflows and runs
(the API the dashboard's workflow builder talks to). A trigger matcher
(event type + zone + confidence + per-(workflow, zone) cooldown) hands
matched events to the **workflow engine**, which executes the workflow's
steps in order and records a Run with per-step status:

- **h_agent** steps — dispatched through **OpenClaw** to H Company agents
  (Runner H / Surfer H): fill Google Forms, create tickets, navigate portals.
- **composio** steps — API work: Drive uploads, Sheets appends, Slack alerts.
- **condition** steps — gate the run on event payload (e.g. `count > 20`).
- **voice** steps (stretch) — Gradium spoken alerts.

Contracts: [../shared/event_schema.json](../shared/event_schema.json) and
[../shared/workflow_schema.json](../shared/workflow_schema.json).

Dev mode: `send_fake_event.py` posts schema-valid fake events, so this side
runs without perception.
