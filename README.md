# Snowglobe
 
Ambient perception → agentic action. A camera watches a space, NVIDIA's
Cosmos 3 Reasoner turns frames into structured events — spills, occupancy,
foot traffic, safety violations — and an automation layer reacts by driving
real software: OpenClaw orchestrates the response, driving H Company's
computer-use agent to fill forms and navigate UIs, while Composio handles
Drive/Sheets/Slack.

Built at The Computer Use Hackathon (H Company × NVIDIA × Accel), SF, Jul 2026.

## Layout

```
perception/    # video → Cosmos 3 Reasoner detections → events (Python)
automation/    # events → triggers → H Company agent + Composio (FastAPI)
dashboard/     # live event feed + agent activity
shared/        # event_schema.json — the contract between the halves
demo/          # pre-recorded clips, fake-event scripts
```

See [PLAN.md](PLAN.md) for the full architecture, demo flows, timeline, and
team split.

## One-command runtime

```bash
make up       # build and supervise dashboard, automation, and perception
make logs     # follow all service logs
make down
```

Docker Compose health-checks each service and restarts failures. Automation's
SQLite database lives in the named `automation-data` volume, including durable
workflow cooldown claims and inventory counts, so restarts do not reset them.
Enable the optional LAN camera gateway with
`docker compose --profile camera-gateway up --build -d`.

## Local acceptance checks

```bash
make check
```

The first run creates an isolated `.venv-check` containing only the Python
packages needed by the automation and perception acceptance suites. The check
runs both Python suites, dashboard interaction tests, the production dashboard
build, and Docker Compose configuration validation.

The following acceptance checks intentionally remain external and must not be
reported as verified by the local suite:

- a physical ONVIF/RTSP camera on the same LAN;
- live H Agent and NemoClaw sessions using the intended hosted/GPU runtime;
- live Gradium voice and third-party MCP destinations;
- Composio tool execution with linked destination accounts.

## Pipeline

video → frame sampler (1 fps) → Cosmos 3 Reasoner via NIM → event normalizer →
`POST /events` → workflow engine (trigger match, dedup/cooldown) → workflow
steps: H agents via OpenClaw (forms, tickets) + Composio (Drive/Sheets/Slack)
→ live runs view in the dashboard.
