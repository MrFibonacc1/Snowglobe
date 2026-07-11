# palantirV2

Ambient perception → agentic action. A camera watches a space, NVIDIA NeMo
(Nemotron VL) turns frames into structured events — spills, occupancy, foot
traffic, safety violations — and an automation layer reacts by driving real
software: OpenClaw orchestrates the response, driving H Company's computer-use
agent to fill forms and navigate UIs, while Composio handles Drive/Sheets/Slack.

Built at The Computer Use Hackathon (H Company × NVIDIA × Accel), SF, Jul 2026.

## Layout

```
perception/    # video → NeMo VLM detections → events (Python)
automation/    # events → triggers → H Company agent + Composio (FastAPI)
dashboard/     # live event feed + agent activity
shared/        # event_schema.json — the contract between the halves
demo/          # pre-recorded clips, fake-event scripts
```

See [PLAN.md](PLAN.md) for the full architecture, demo flows, timeline, and
team split.

## Pipeline

video → frame sampler (1 fps) → Nemotron VL via NIM → event normalizer →
`POST /events` → workflow engine (trigger match, dedup/cooldown) → workflow
steps: H agents via OpenClaw (forms, tickets) + Composio (Drive/Sheets/Slack)
→ live runs view in the dashboard.
