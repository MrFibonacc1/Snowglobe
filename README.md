# Snowglobe

> Any security camera, turned into an agent that sees an incident and does the
> follow-up work on its own.

Snowglobe watches a space through an ordinary security camera, understands what
is happening, and reacts by driving real software: filling out web forms,
updating spreadsheets, and posting to Slack.

- [The problem](#the-problem)
- [What it does](#what-it-does)
- [Demo](#demo)
- [How it works](#how-it-works)
- [Features](#features)
- [Built with](#built-with)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Testing](#testing)
- [Roadmap](#roadmap)
- [Team](#team)

## The problem

Every shop, warehouse, and lobby already runs cameras. They record everything
and act on nothing. Someone still has to watch a wall of monitors, or scrub the
footage after the incident already happened, and then do the work by hand: file
the facilities ticket, update the inventory sheet, reorder the stock, message
the manager. Usually no one is watching, so the spill sits, the shelf stays
empty, and the hazard goes unlogged until it turns into a problem.

The follow-up is the bottleneck. It has to happen every time, within seconds,
and today a person has to be watching for it to happen at all. That work,
clicking through a portal or updating a sheet, is exactly what a computer-use
agent is good at.

## What it does

Snowglobe closes the gap. It watches a space, names what it sees, and runs the
response as an ordered set of steps.

A spill spreads near the loading bay. Snowglobe sees it, files a facilities
incident in the web portal, logs it to a Google Sheet, and pings the manager in
Slack. An item comes off a shelf and stock runs low. Snowglobe counts it,
adjusts inventory, and drafts a reorder. Both flows are seeded and running the
moment you open the dashboard.

## Demo

Start it with `make up` and open the dashboard at `http://localhost:5173`. It
ships with seeded workflows, so within seconds you see events land in the live
feed and agent runs execute step by step. Fire your own from the Testing page,
or drop a clip on the perception service to watch it name events in real time.

Nothing needs an API key to try: every external service has a mock, so the whole
pipeline runs offline and still produces live runs you can watch.

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

## Features

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
- **FastAPI** and SQLite for the workflow engine, **React** and **Vite** for the
  dashboard, **OpenCV** for frame sampling.

## Architecture

Three services talk over one HTTP event contract, so each half can run and be
tested on its own.

```
perception/    video to vision-reasoner detections to events (Python)
automation/    events to triggers to H Company agent and Composio (FastAPI)
dashboard/     live event feed, workflow builder, and agent activity (React)
shared/        event and workflow schemas, the contract between the halves
demo/          pre-recorded clips and event sender scripts
deploy/        Docker images and the edge camera-gateway bundle
```

Perception runs at the edge, next to the camera. Video never leaves the local
network; only small event payloads are posted to the automation service, which
can live anywhere. See [PLAN.md](PLAN.md) for the full architecture and
[docs/CAMERA_INTEGRATION.md](docs/CAMERA_INTEGRATION.md) for how cameras connect.

## Getting started

You need Docker and Docker Compose. For local development without Docker, use
Node 22 or newer for the dashboard and Python 3.11 or newer for the services.

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

## Configuration

Everything runs in mock mode with no credentials, which is enough to demo the
full pipeline. To wire up the real services, copy each `.env.example` and fill in
the keys you have:

- `perception/.env`: `NVIDIA_API_KEY` for the vision reasoner (or run with
  `--mock`). `GROUNDING_ENABLED` toggles local YOLO.
- `automation/.env`: `HAI_API_KEY` with `H_AGENT_MODE=agent_api` for the H
  Company agent, `COMPOSIO_API_KEY` for Drive, Sheets, and Slack, and
  `GRADIUM_API_KEY` for voice.
- `dashboard/.env`: `VITE_AUTOMATION_URL` and `VITE_PERCEPTION_URL` point the UI
  at the two backends. They default to localhost.

## Testing

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

## Roadmap

- Package perception and the go2rtc gateway as a single edge bundle for a
  mini-PC or Raspberry Pi in the shop.
- Add the cloud-camera bridges (Wyze, Nest, Ring) behind the same gateway.
- Run the Cosmos physical-AI reasoner self-hosted on a GPU box once one is
  available, in place of the hosted vision-language fallback.
- Secret storage for camera and destination credentials.

## Team

Built by a team of three over the hackathon, split by system: perception,
automation, and the dashboard. See [PLAN.md](PLAN.md) for the split.

Built at The Computer Use Hackathon (H Company, NVIDIA, and Accel), SF, July 2026.
