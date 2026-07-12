# Snowglobe

A camera watches a space. NVIDIA's Cosmos 3 Reasoner turns the frames into
structured events like spills, occupancy, foot traffic, and safety violations.
An automation layer reacts by driving real software: OpenClaw orchestrates the
response and drives H Company's computer-use agent to fill forms and navigate
UIs, while Composio handles Drive, Sheets, and Slack.

Built at The Computer Use Hackathon (H Company, NVIDIA, Accel), SF, July 2026.

## Layout

```
perception/    video to Cosmos 3 Reasoner detections to events (Python)
automation/    events to triggers to H Company agent and Composio (FastAPI)
dashboard/     live event feed and agent activity
shared/        event_schema.json, the contract between the halves
demo/          pre-recorded clips and event sender scripts
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

The first run creates an isolated `.venv-check` with only the Python packages
the automation and perception suites need. The check runs both Python suites,
the dashboard interaction tests, the production dashboard build, and Docker
Compose configuration validation.

These checks stay external on purpose and are not reported as verified by the
local suite:

- a physical ONVIF/RTSP camera on the same LAN;
- live H Agent and NemoClaw sessions on the intended hosted/GPU runtime;
- live Gradium voice and third-party MCP destinations;
- Composio tool execution with linked destination accounts.

## Pipeline

```
video
  -> frame sampler (~0.3 fps)
  -> Cosmos 3 Reasoner via NIM
  -> event normalizer
  -> POST /events
  -> workflow engine (trigger match, dedup/cooldown)
  -> workflow steps: H agents via OpenClaw (forms, tickets)
                     + Composio (Drive, Sheets, Slack)
  -> live runs view in the dashboard
```
