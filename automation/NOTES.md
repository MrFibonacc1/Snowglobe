# Integration notes — H Company & Composio

How the two external integrations work and how to flip them from stub/mock to
real. The service runs fully without any keys (h_agent mocks, composio stubs)
so nobody is ever blocked.

## H Company agent (`steps/h_agent.py`)

Uses H's open-source **surfer-h-cli** (github.com/hcompai/surfer-h-cli) — a
Selenium browser agent driven by the Holo models. Two backends, selected by
`H_AGENT_MODE`:

| Mode | What happens |
|---|---|
| `mock` (default) | Simulates a 4s agent run; output says what it *would* do. Demo-safe, no keys. |
| `surfer_cli` | Invokes the real `surfer-h-cli` console script against the hosted Holo API. |

### One-command setup (verified)

```bash
bash automation/setup_h_agent.sh
```

This clones surfer-h-cli next to `automation/` (→ `companyH/surfer-h-cli`,
gitignored) and builds a **client-only venv** — it installs `requirements.txt`
(openai, selenium, seleniumbase, pydantic, pillow) + the package with
`--no-deps`, deliberately skipping the heavy `vllm`/`transformers` stack in
`pyproject.toml` (that's only for *self-hosting* the model; we call the hosted
API). Verified: `surfer-h-cli --help` runs from the client venv with no GPU deps.

Then run the automation service with:

```bash
export H_AGENT_MODE=surfer_cli
export HAI_API_KEY=<key from portal.hcompany.ai>   # we have credits
# optional (defaults from surfer-h-cli/.env.example):
# export HAI_MODEL_URL=https://api.hcompanyprod.fr/v1/models/holo1-7b-20250521
# export HAI_MODEL_NAME=holo1-7b-20250521
```

### What the executor runs

Mirrors the repo's `run-on-holo.sh` exactly (verified against the CLI's real
argparse): navigation + localization both target the hosted Holo model, and
`API_KEY_NAVIGATION` / `API_KEY_LOCALIZATION` are set from `HAI_API_KEY`.
It parses the agent's `💬 Answer :` line from stdout into the run output and
keeps the trajectory tail (what the dashboard shows). Retries once (agent runs
are flaky). Env knobs: `SURFER_H_BIN`, `H_AGENT_MAX_STEPS`, `H_AGENT_MAX_TIME_SEC`,
`H_AGENT_HEADLESS` (1/0).

### ⚠️ Known local gotcha — Chrome/Selenium (must resolve before real runs)

On this machine (Chrome 150 + selenium 4.46), launching the browser fails with
`SessionNotCreatedException: unable to discover open pages`, both headless and
headed — even though chromedriver matches Chrome exactly. It's a Chrome-version/
Selenium quirk, **not** our wiring: setup, CLI, args, key-passing, and Chrome
launch all fire correctly; it dies at Selenium session creation. Everything up
to the hosted API call is proven.

Fixes to try at the event (in order):
1. Different demo machine / slightly older Chrome — often just works.
2. In `surfer-h-cli/src/surfer_h_cli/simple_browser.py::open_browser`, add a
   fresh profile dir: `options.add_argument(f"--user-data-dir={tempfile.mkdtemp()}")`
   and switch `--headless` → `--headless=new`. (Local patch to the vendored
   clone; not committed to our repo.)
3. Ask H mentors whether the hosted **Runner H / Studio API** is open to
   hackathon keys — that's an HTTP API with no local browser at all; if so,
   add it as a third `H_AGENT_MODE` and skip Selenium entirely. Cleanest path.

Until resolved, `H_AGENT_MODE=mock` fully demos the pipeline.

### Alternatives
- Self-host Holo via vLLM (`vllm serve Hcompany/Holo1-7B`) and point
  `HAI_MODEL_URL` at it — relevant for the NVIDIA challenge (their GPUs).
- `surfer-h-cli/launch.sh` runs a backend + Next.js viewer on :3000 — useful
  for capturing a visual replay for the demo.

## Composio (`steps/composio_step.py`)

One SDK for the API-shaped actions (Slack, Drive, Sheets), auth per connected
account.

```bash
pip install composio
composio login                                  # or export COMPOSIO_API_KEY=...
composio connected-accounts link slack          # OAuth, once per toolkit
composio connected-accounts link googledrive
composio connected-accounts link googlesheets
```

The executor calls `client.tools.execute(slug=…, user_id=…, arguments=…)`.
Slugs used (verify with `composio tools info <SLUG>` after linking — names
occasionally change):

| Our action | Composio slug | Arguments |
|---|---|---|
| `slack_message` | `SLACK_SEND_MESSAGE` | channel, text |
| `drive_upload` | `GOOGLEDRIVE_UPLOAD_FILE` | file_to_upload, folder_to_upload_to |
| `sheets_append` | `GOOGLESHEETS_BATCH_UPDATE` | spreadsheet_id, sheet_name, values |

Without `COMPOSIO_API_KEY`, every action logs its payload and returns
`{"stubbed": true}` — runs still complete, dashboard still animates.

## Env summary

| Var | Needed for |
|---|---|
| `H_AGENT_MODE` | `mock` (default) / `surfer_cli` |
| `HAI_API_KEY` | surfer_cli mode (hosted Holo) |
| `HAI_MODEL_URL`, `HAI_MODEL_NAME` | optional overrides (sensible defaults) |
| `SURFER_H_CLI_DIR`, `SURFER_H_BIN` | override clone / console-script location |
| `H_AGENT_HEADLESS`, `H_AGENT_MAX_STEPS`, `H_AGENT_MAX_TIME_SEC` | agent tuning |
| `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID` | real Composio actions |
| `GRADIUM_API_KEY` | voice step (stretch, not implemented) |
| `AUTOMATION_DB` | SQLite path override (default `automation/data.db`) |
