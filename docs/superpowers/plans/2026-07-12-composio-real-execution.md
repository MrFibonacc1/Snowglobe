# Composio Real Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a Composio workflow step is reported as successful only when Composio confirms the external action executed, while exposing honest integration readiness in the API and dashboard.

**Architecture:** Make the Composio executor fail closed: missing credentials, unavailable execution rights, missing linked accounts, and unsuccessful SDK responses raise a typed execution error. Add a cached readiness probe shared by `/status` and the executor so the dashboard distinguishes key presence, execution permission, and toolkit linkage without exposing secrets or repeatedly calling Composio.

**Tech Stack:** Python 3, FastAPI, Composio Python SDK, `unittest`, React 19, TypeScript, Vite.

## Global Constraints

- Never display or log credential values.
- Never report a Composio action as `done` unless the SDK response confirms success.
- Slack, Google Sheets, and Google Drive readiness must be reported separately.
- External OAuth/account linking still requires the account owner; the product must display that blocker truthfully.

---

### Task 1: Fail closed on non-executed Composio actions

**Files:**
- Create: `automation/tests/test_composio_step.py`
- Modify: `automation/steps/composio_step.py`

**Interfaces:**
- Consumes: workflow step config and event dictionaries.
- Produces: `execute(config, event) -> dict` only for confirmed execution; otherwise raises `ComposioExecutionError`.

- [x] **Step 1: Write failing tests** for missing keys, 401 execution denial, missing connected accounts, unsuccessful SDK responses, and successful execution.
- [x] **Step 2: Run `python -m unittest automation/tests/test_composio_step.py -v`** and verify the new expectations fail against the stub behavior.
- [x] **Step 3: Implement `ComposioExecutionError` and confirmed-success validation** while keeping SDK creation injectable through a small client factory.
- [x] **Step 4: Re-run the focused test** and require all cases to pass.

### Task 2: Expose real Composio readiness

**Files:**
- Create: `automation/tests/test_composio_status.py`
- Create: `automation/composio_status.py`
- Modify: `automation/main.py`
- Modify: `dashboard/src/api.ts`
- Modify: `dashboard/src/pages/Integrations.tsx`

**Interfaces:**
- Produces: `get_composio_status(refresh: bool = False) -> dict` with `key_present`, `execution_ready`, `toolkits`, `reason`, and `checked_at`.
- API: `GET /status` returns the readiness object under `composio`.

- [x] **Step 1: Write failing readiness tests** for missing key, management-only key, missing toolkit accounts, and fully ready state.
- [x] **Step 2: Run the focused readiness tests** and confirm failure because the module/API does not exist.
- [x] **Step 3: Implement a time-limited cached probe** that checks active accounts and a no-auth Composio tool execution without exposing the key.
- [x] **Step 4: Update the dashboard contract and integration cards** so each provider is connected only when execution is enabled and its toolkit is active; show the exact blocker otherwise.
- [x] **Step 5: Re-run Python tests and `npm run build`** and require clean exits.

### Task 3: Verify the original symptom

**Files:**
- Modify: `automation/tests/test_engine.py`

**Interfaces:**
- Consumes: an executor that raises `ComposioExecutionError`.
- Produces: persisted run state with the Composio step and overall run marked `failed`.

- [x] **Step 1: Add a regression test** proving an unavailable Composio action cannot produce `step.status == "done"` or `run.status == "done"`.
- [x] **Step 2: Run the test and confirm the original behavior fails the assertion.**
- [x] **Step 3: Make the smallest engine change only if required**; existing exception handling should already provide the correct failed state once Task 1 fails closed.
- [x] **Step 4: Run the complete Python test suite and dashboard build.**
- [x] **Step 5: Run the live Composio connection diagnostic** and report the remaining external blockers: execution-enabled key plus Slack/Sheets/Drive OAuth linkage.

## Verification result (2026-07-12)

- Python regression suite: 10 tests passed.
- Dashboard production build: passed.
- Live Composio management API: key authenticated for read access; 6 accounts found.
- Required linked accounts: Slack, Google Sheets, and Google Drive are not connected (only Reddit is active).
- Live no-auth tool execution probe: failed with HTTP 401; the installed key does not have tool-execution rights.
- Resulting product behavior: Composio steps and their workflow runs now fail with an explicit error until real execution is confirmed; the dashboard reports the readiness blockers rather than showing a false success.
