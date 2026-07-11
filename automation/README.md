# automation

Events in → triggers → actions.

FastAPI service exposing `POST /events`. A trigger engine (per zone/event-type
dedup + cooldown) maps events to recipes:

- **H Company agent** (Runner H / Surfer H) — UI work: fill incident forms,
  raise safety tickets, navigate portals.
- **Composio** — API work: Drive uploads, Sheets appends, Slack alerts.

Dev mode: `send_fake_event.py` posts schema-valid fake events, so this side
runs without perception.
