# Integration notes — H Company & Composio

How the two external integrations work and how to flip them from stub/mock to
real. The service runs fully without any keys (h_agent mocks, composio stubs)
so nobody is ever blocked.

## H Company agent (`steps/h_agent.py`)

⚠️ **Update:** the open-source `surfer-h-cli` we first targeted is **deprecated
and unmaintained**, and its hosted endpoint (`api.hcompanyprod.fr`) is dead.
H's supported path is now the hosted **Computer-Use Agent API** — a fully
hosted browser agent, so **no local Selenium/Chrome needed.** We rebuilt the
step against it.

Modes (`H_AGENT_MODE`):

| Mode | What happens |
|---|---|
| `mock` (default) | Simulates a 4s run; demo-safe, no keys. |
| `agent_api` | **Recommended.** Calls the hosted Agent API over HTTP (httpx). No browser. |
| `surfer_cli` | Legacy. Deprecated upstream; only for self-hosting Holo via vLLM. Needs local Chrome. |

### agent_api setup (this is all it takes)

```bash
pip install -r requirements.txt        # httpx — nothing else
export H_AGENT_MODE=agent_api
export HAI_API_KEY=hk-...               # from portal.hcompany.ai
# optional: export HAI_AGENT_REGION=us  (default eu)
#           export HAI_AGENT_NAME=h/web-surfer-flash
```

No clone, no venv, no browser. The step:
1. `POST {base}/sessions` with `{"agent": "h/web-surfer-flash", "messages":[{"type":"user_message","message":"Go to <url>. <instructions>"}]}`
2. polls `GET {base}/sessions/{id}` until `finished_at` / terminal status
3. returns `session_id`, **`agent_view_url`** (a live/replay link — surface it in
   the dashboard runs view!), `status`, `outcome`, and `latest_answer`.

Base URLs: EU `https://agp.eu.hcompany.ai/api/v2` · US `https://agp.hcompany.ai/api/v2`.

### Verified status (2026-07-11, evening) — ✅ FULLY WORKING

The earlier "sessions stall at steps: 0" issue is **resolved** (entitlement
kicked in). Verified end to end with the team key:
- ✅ Auth: `GET /sessions` → 200 (a rejected key gets **403**, not 401).
- ✅ Standalone: `python test_h_connection.py` → agent navigated example.com
  and answered in ~22s (status=idle, steps=2).
- ✅ **Full pipeline**: fake spill event → workflow engine → h_agent step →
  real hosted session → answer + `agent_view_url` captured in the run output
  (22.7s). Agents also degrade gracefully: pointed at the placeholder
  forms.gle URL, the agent completed and *reported* the link was dead.

Ops notes:
- The key lives in `automation/.env` (gitignored); `envload.py` auto-loads it
  for both `main.py` and `test_h_connection.py` — no exports needed.
- `H_AGENT_MODE` still defaults to `mock` (safe). Run real mode with
  `H_AGENT_MODE=agent_api uvicorn main:app --port 8000`, or add
  `H_AGENT_MODE=agent_api` to `.env` to make it the default.
- Each h_agent step consumes one hosted session (~20-30s) — replace the
  seeded placeholder form URL with a real Google Form before enabling real
  mode broadly, or every spill event spends a session on a dead link.

### Alternatives / notes
- SDK: `pip install hai-agents` gives a typed client (`Client(api_key=...)`,
  sync + async). We use raw HTTP to keep the automation service dependency-free
  beyond httpx; swap in the SDK if you prefer typed responses.
- Models API (`https://api.hcompany.ai/v1/`, OpenAI-compatible) serves the raw
  Holo VLMs — a different product from the Agent API; not needed here.
- Legacy self-host: `surfer-h-cli/launch.sh` runs a local viewer on :3000;
  requires vLLM-served Holo + working local Chrome (see gotcha below).

### Legacy Chrome gotcha (surfer_cli mode only)
On Chrome 150 + selenium 4.46, the local Selenium agent fails with
`SessionNotCreatedException: unable to discover open pages` (matching driver,
both headless/headed). Irrelevant to `agent_api`. If you must use surfer_cli,
patch `simple_browser.py::open_browser` with a fresh `--user-data-dir` and
`--headless=new`.

## Composio (`steps/composio_step.py`)

One SDK for the API-shaped actions (Slack, Drive, Sheets), auth per account.

```bash
pip install composio
composio login                                  # or export COMPOSIO_API_KEY=...
composio connected-accounts link slack          # OAuth, once per toolkit
composio connected-accounts link googledrive
composio connected-accounts link googlesheets
```

Executor calls `client.tools.execute(slug=…, user_id=…, arguments=…)`. Slugs
(verify with `composio tools info <SLUG>` after linking):

| Our action | Composio slug | Arguments |
|---|---|---|
| `slack_message` | `SLACK_SEND_MESSAGE` | channel, text |
| `drive_upload` | `GOOGLEDRIVE_UPLOAD_FILE` | file_to_upload, folder_to_upload_to |
| `sheets_append` | `GOOGLESHEETS_BATCH_UPDATE` | spreadsheet_id, sheet_name, values |

Without `COMPOSIO_API_KEY`, actions log their payload and return
`{"stubbed": true}` — runs still complete, dashboard still animates.

### Verified status (2026-07-11) — ⚠️ key reads but cannot execute

Ran `python test_composio_connection.py` with the provided key:
- ✅ **AUTH**: key is valid for the management API (lists 6 connected accounts).
- ✅ **SDK/code path**: our `composio_step.py` call shape matches SDK 0.17.1.
  Fixed one real bug — 0.17+ requires a toolkit version for manual execution,
  so we now pass `dangerously_skip_version_check=True`.
- ❌ **EXECUTE**: `tools.execute` returns **401 "Invalid API key"** even for a
  no-auth utility tool. Confirmed at the HTTP level: the SAME key + same
  `x-api-key` header gets **200 on every GET** (`/api/v3.1/connected_accounts`,
  `/tools/...`) but **401 on `POST /api/v3.1/tools/execute/...`**. Same host
  (`backend.composio.dev`), so it's not region/URL — the key is scoped to
  read/management only. No code change (header, version, user_id) can fix it.
- ❌ **Accounts**: the only ACTIVE connected account is `reddit`. There is **no
  Slack / Google Sheets / Google Drive** connection — which is what our
  workflows use.

**Graceful degradation (added):** on a 401/"not configured" error the
`composio` step no longer fails the run — it returns
`{stubbed, unavailable, reason}` and the step is marked `done`, so a workflow's
H-agent step still succeeds. Genuine errors (bad args, unknown tool) still
raise. Verified: occupancy workflow → run `done`, composio step `unavailable`.

**To make it actually run (two independent blockers, both user-side):**
1. Get a Composio key with **tool-execution** rights (or enable execution on
   this account/plan) — verify with `test_composio_connection.py` step 3 → OK.
2. Link the toolkits (one OAuth click each, opens in a browser):
   `composio connected-accounts link slack` (+ googlesheets, googledrive),
   done under the same `user_id` our steps use (`COMPOSIO_USER_ID`, default
   `default`). Existing accounts on this key use `user_id=local`.
Once both are green, `composio` steps run for real with zero code changes.
Meanwhile the generic `mcp` step is a working alternative (H's MCP verified).

## MCP step (`steps/mcp_step.py`) — the flexible integration lane

A generic step that calls **any tool on any MCP server** (streamable HTTP):

```json
{ "type": "mcp", "config": {
    "server_url": "https://<your-mcp-server>/mcp",
    "tool": "sheets_append_row",
    "arguments": { "spreadsheet": "incidents",
                   "values": ["{{event.timestamp}}", "{{event.location}}"] } } }
```

- Templating applies inside `arguments`, so camera data flows into the tool.
- Auth: `MCP_SERVER_TOKEN` env (or per-step `token`) is sent as a Bearer
  header; servers with their own OAuth (hosted Google MCPs) handle it after a
  one-time account link on the server's side.
- Defaults: `MCP_SERVER_URL` env is used when a step omits `server_url`.
- Verified against `mock_mcp_server.py`
  (`.venv/bin/uvicorn mock_mcp_server:app --port 8200`) — full pipeline:
  fake spill → workflow → mcp step → tool call with templated args. ✅

For Google Sheets/Drive specifically, point it at any Google Workspace MCP
server (hosted ones exist — e.g. Composio's per-toolkit MCP URLs — or run a
community Google MCP server; either way the tool names come from that
server's `tools/list`). Check the exact tool names/args before the demo.

## Env summary

| Var | Needed for |
|---|---|
| `H_AGENT_MODE` | `mock` (default) / `agent_api` / `surfer_cli` |
| `HAI_API_KEY` | agent_api (and surfer_cli) |
| `HAI_AGENT_REGION` | `eu` (default) / `us` |
| `HAI_AGENT_BASE_URL`, `HAI_AGENT_NAME` | agent_api overrides |
| `H_AGENT_TIMEOUT_SEC`, `H_AGENT_POLL_SEC` | agent_api polling |
| `SURFER_H_CLI_DIR`, `SURFER_H_BIN`, `HAI_MODEL_URL`, `HAI_MODEL_NAME` | legacy surfer_cli |
| `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID` | real Composio actions |
| `GRADIUM_API_KEY` | voice step (stretch, not implemented) |
| `AUTOMATION_DB` | SQLite path override (default `automation/data.db`) |
