# Integration notes — H Company & Composio

How the two external integrations actually work and how to flip them from
stub/mock to real. The service runs fully without any keys (h_agent mocks,
composio stubs) so nobody is ever blocked.

## H Company agent (`steps/h_agent.py`)

Two backends, selected by `H_AGENT_MODE`:

| Mode | What happens |
|---|---|
| `mock` (default) | Simulates a 4s agent run; output says what it *would* do. Demo-safe. |
| `surfer_cli` | Shells out to H's [surfer-h-cli](https://github.com/hcompai/surfer-h-cli): a Holo-model-driven browser agent that navigates the target URL and performs the instructions. |

### Going real

1. Get an API key at **portal.hcompany.ai** (we have credits).
2. `git clone https://github.com/hcompai/surfer-h-cli` somewhere; install `uv`.
3. Env:
   ```bash
   export H_AGENT_MODE=surfer_cli
   export SURFER_H_CLI_DIR=~/src/surfer-h-cli
   export HAI_API_KEY=...        # portal.hcompany.ai
   export HAI_MODEL_URL=...      # hosted Holo endpoint from the portal docs
   export HAI_MODEL_NAME=...
   ```
4. The executor invokes:
   `uv run src/surfer_h_cli/surferh.py --task "<instructions>" --url "<url>" --max_n_steps 30`
   with one retry, 300s timeout, and stores the trajectory tail in the step
   output (the dashboard renders it).

Notes for the team:
- The CLI's repo also ships `./launch.sh` (backend + Next.js viewer on :3000)
  — useful for capturing a **visual replay** for the demo.
- Alternative to the CLI: self-host Holo via vLLM
  (`vllm serve Hcompany/Holo1-7B`) and point `HAI_MODEL_URL` at it — relevant
  for the NVIDIA challenge (runs on their GPU).
- Ask H mentors day-of whether the hosted **Runner H / Studio API** is open to
  hackathon keys; if yes, add it as a third backend (HTTP, no subprocess).

## Composio (`steps/composio_step.py`)

Composio = one SDK for the API-shaped actions (Slack, Drive, Sheets), with
auth handled per connected account.

### Going real

```bash
pip install composio
composio login                                  # or export COMPOSIO_API_KEY=...
composio connected-accounts link slack          # opens OAuth, once per toolkit
composio connected-accounts link googledrive
composio connected-accounts link googlesheets
```

The executor calls `client.tools.execute(slug=…, user_id=…, arguments=…)`.
Slugs used (verify with `composio tools info <SLUG>` after linking — names
occasionally change):

| Our action | Composio slug | Arguments we send |
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
| `SURFER_H_CLI_DIR`, `HAI_API_KEY`, `HAI_MODEL_URL`, `HAI_MODEL_NAME` | surfer_cli mode |
| `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID` | real Composio actions |
| `GRADIUM_API_KEY` | voice step (stretch, not implemented) |
| `AUTOMATION_DB` | SQLite path override (default `automation/data.db`) |
