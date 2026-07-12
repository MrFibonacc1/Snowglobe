# Snowglobe

Every shop, warehouse, and lobby already runs cameras. They record everything
and act on nothing. Someone still has to watch a wall of monitors, or scrub the
footage after the incident already happened, and then do the work by hand:
file the facilities ticket, update the inventory sheet, reorder the stock,
message the manager. Usually no one is watching, so the spill sits, the shelf
stays empty, and the hazard goes unlogged until it turns into a problem.

The follow-up is the bottleneck. It has to happen every time, within seconds,
and today a person has to be watching for it to happen at all. That work,
clicking through a portal or updating a sheet, is exactly what a computer-use
agent is good at.

Snowglobe closes the gap. It watches a space through an ordinary security
camera, understands what is happening, and reacts by driving real software:
filling out web forms, updating spreadsheets, and posting to Slack on its own.

A spill spreads near the loading bay. Snowglobe sees it, files a facilities
incident in the web portal, logs it to a Google Sheet, and pings the manager in
Slack. An item comes off a shelf and stock runs low. Snowglobe counts it,
adjusts inventory, and drafts a reorder. Both flows are seeded and running the
moment you open the dashboard.

## How it works

```
video
  -> frame sampler (~0.3 fps)
  -> NVIDIA vision reasoner on NIM
  -> event normalizer + local YOLO grounding
  -> POST /events
  -> workflow engine (trigger match, dedup/cooldown)
  -> workflow steps: H Company agent via OpenClaw (forms, tickets)
                     + Composio (Drive, Sheets, Slack)
  -> live runs view in the dashboard
```

Perception samples frames from any camera and asks NVIDIA's vision reasoner what
is going on. The model names events on its own, like `spill`, `blocked_exit`,
`overcrowding`, or `missing_ppe`, instead of choosing from a fixed list, and each
one is cross-checked against a local YOLO detector so the confidence you see is
grounded rather than guessed.

Every event flows into a workflow engine. You compose automations visually: a
trigger (event type, zone, confidence, cooldown) and an ordered list of steps.
Steps drive an H Company computer-use agent through OpenClaw to fill forms and
click through web portals, or call Composio for Drive, Sheets, and Slack. A live
dashboard shows every detection and every agent run, step by step.

## Highlights

- **Open-ended perception:** the model names events itself, so the system is not
  limited to a handful of hard-coded classes.
- **Grounded confidence:** VLM findings are fused with a local YOLO detector, and
  high-risk alerts like a person on the ground require independent visual
  corroboration before they fire.
- **Visual workflow builder:** drag-and-connect nodes for triggers and steps, or
  describe the automation in plain English and let the NVIDIA Nemotron builder
  draft it for you.
- **Fail-closed actions:** agent runs and Composio calls report failure instead
  of silently claiming success, so the run log reflects what actually happened.
- **Durable runtime:** cooldown claims and inventory counts live in SQLite and
  survive restarts, so a camera cannot fire the same incident twice.
- **Scheduled workflows:** cron triggers and 24-hour event digests, not just
  live reactions.
- **Bring your own camera:** a go2rtc gateway plus ONVIF auto-discovery connect
  Hikvision, Dahua, Amcrest, Reolink, and other ONVIF cameras. Scan the LAN, pick
  a camera, connect. Video stays on the local network and only events leave.

## Built with

- **H Company** computer-use agents through OpenClaw, with a NemoClaw path that
  runs Holo locally on NVIDIA GPUs.
- **NVIDIA** vision reasoning on NIM (the Cosmos physical-AI reasoner where GPUs
  are available, a Nemotron vision-language model on hosted inference) plus local
  YOLO grounding.
- **Composio** for Drive, Sheets, and Slack.
- **Gradium** voice for spoken alerts.

Built at The Computer Use Hackathon (H Company, NVIDIA, and Accel), SF, July 2026.

## Repo layout

```
perception/    video to vision-reasoner detections to events (Python)
automation/    events to triggers to H Company agent and Composio (FastAPI)
dashboard/     live event feed, workflow builder, and agent activity (React)
shared/        event and workflow schemas, the contract between the halves
demo/          pre-recorded clips and event sender scripts
```

See [PLAN.md](PLAN.md) for the full architecture, demo flow, timeline, and team
split.

## Run it

```bash
make up       # build and supervise dashboard, automation, and perception
make logs     # follow all service logs
make down
```

Docker Compose health-checks each service and restarts failures. The automation
database lives in the named `automation-data` volume, including durable workflow
cooldown claims and inventory counts, so restarts do not reset them. Enable the
optional LAN camera gateway with
`docker compose --profile camera-gateway up --build -d`.

## Acceptance checks

```bash
make check
```

The first run creates an isolated `.venv-check` with only the Python packages the
automation and perception suites need. The check runs both Python suites, the
dashboard interaction tests, the production dashboard build, and Docker Compose
configuration validation.

These checks stay external on purpose and are not reported as verified by the
local suite:

- a physical ONVIF/RTSP camera on the same LAN;
- live H Agent and NemoClaw sessions on the intended hosted or GPU runtime;
- live Gradium voice and third-party MCP destinations;
- Composio tool execution with linked destination accounts.
