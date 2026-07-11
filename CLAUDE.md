# palantirV2 — Agent Context

Hackathon project (Computer Use Hackathon, 48h). Cameras → NVIDIA NeMo VLM
detections → structured events → custom workflow engine → H Company agents
(via OpenClaw) + Composio actions. Read [PLAN.md](PLAN.md) first — it defines
the architecture, data contracts, and work split. This file is operational
context for agents working in this repo.

## Hard rules

- **Contracts are frozen.** `shared/event_schema.json` and
  `shared/workflow_schema.json` are the interfaces between workstreams.
  Do not change them without flagging it loudly — other people/agents are
  building against them in parallel.
- **No imports across top-level directories.** `perception/`, `automation/`,
  and `dashboard/` are independent services talking over HTTP only.
- **Every boundary has a fake.** If the thing you depend on isn't built yet,
  use its fake (see per-task briefs); never block.
- Hackathon code: favor working and simple over polished. No tests required
  unless a brief says so. Do add docstrings/comments at tricky spots.

## State of the repo

- `dashboard/` — **BUILT and working** (React/Vite/TS, mock-backed with
  localStorage + event simulation). `npm install && npm run dev` →
  http://localhost:5173. `npm run build` typechecks.
- `perception/`, `automation/` — README stubs only, not yet implemented.
- `shared/` — both schema files exist.
- Task briefs for the three workstreams live in `tasks/`.

## Conventions

- Python 3.11+, FastAPI for services, `requests`/`httpx` for clients.
  Keep dependencies minimal; a `requirements.txt` per service directory.
- Automation service runs on **port 8000**; dashboard dev server on 5173;
  dashboard reads `VITE_AUTOMATION_URL` (see `dashboard/.env.example`).
- Secrets via environment variables, never committed: `NVIDIA_API_KEY`
  (NIM), `H_API_KEY` (H Company), `COMPOSIO_API_KEY`. Local `.env` files are
  gitignored.
- Git: work on feature branches, push, open PRs against `main`. Short
  one-line commit messages.
