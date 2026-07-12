# Close Local Acceptance Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every acceptance gap that can be solved and verified locally without external accounts, physical cameras, or user-operated services.

**Architecture:** Keep normalization in `shared`, terminal-agent handling in the H step adapter, and acceptance checks at each service boundary. Add a lightweight local test environment so `make check` does not depend on globally installed Python packages, while Docker Compose remains the production-style supervised runtime.

**Tech Stack:** Python 3.12, `unittest`, FastAPI, OpenCV headless, React 19, Vitest, Docker Compose, SQLite.

## Global Constraints

- Do not claim external Slack, Sheets, Drive, Gradium, H Agent, NemoClaw, MCP, or physical-camera execution without live credentials/hardware evidence.
- Preserve open-ended discovery for unknown event types.
- Normalize only aliases with clear product semantics; ambiguous findings must not trigger destructive inventory actions.
- Use test-first red/green cycles for behavior changes.

---

### Task 1: Reproducible local verification

**Files:**
- Create: `requirements-test.txt`
- Create: `scripts/check-local.sh`
- Modify: `Makefile`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: existing automation, perception, and dashboard test commands.
- Produces: `make setup-check` and `make check` using `.venv-check/bin/python`.

- [x] **Step 1: Add a smoke test that imports the exact modules exercised by the suites.**
- [x] **Step 2: Run it with system Python and record the missing dependency failure.**
- [x] **Step 3: Add the minimal test requirements and isolated environment bootstrap.**
- [x] **Step 4: Run all Python tests, dashboard tests/build, and Compose config validation.**

### Task 2: Agent terminal-state recovery

**Files:**
- Modify: `automation/tests/test_h_agent.py`
- Modify: `automation/steps/h_agent.py`
- Modify: `automation/README.md`

**Interfaces:**
- Consumes: H session snapshots returned by `GET /sessions/{id}`.
- Produces: one final status refresh after the polling budget and a usable answer only for terminal sessions.

- [x] **Step 1: Add a failing test where the budget expires but the final refresh returns completed.**
- [x] **Step 2: Confirm the test fails because the current adapter returns the stale running snapshot.**
- [x] **Step 3: Add a bounded final refresh without weakening fail-closed answer validation.**
- [x] **Step 4: Run H adapter and engine regression tests.**

### Task 3: Conservative discovery normalization

**Files:**
- Modify: `perception/tests/test_event_normalization.py`
- Modify: `perception/tests/test_event_matrix.py`
- Modify: `shared/event_normalization.py`

**Interfaces:**
- Consumes: arbitrary model-generated event labels.
- Produces: stable canonical slugs for spill, PPE, crowd, fall, and explicit shelf-removal semantics while preserving unknown slugs.

- [x] **Step 1: Add failing table tests for common morphological and phrase variants.**
- [x] **Step 2: Add a failing safety test proving ambiguous interaction labels do not become inventory removals.**
- [x] **Step 3: Implement token-aware rules ordered from specific to general.**
- [x] **Step 4: Run normalization and representative event-matrix tests.**

### Task 4: Locally executable acceptance surfaces

**Files:**
- Create: `dashboard/src/pages/Cameras.test.tsx`
- Modify: `dashboard/src/pages/WorkflowBuilder.test.tsx`
- Modify: `automation/tests/test_mcp_step.py`
- Modify: `automation/tests/test_nemoclaw_step.py`
- Modify: `automation/tests/test_voice_step.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: UI components and step adapters with local stub clients/servers.
- Produces: regression coverage for camera rendering/connection UI, workflow inventory configuration, MCP protocol success/error, NemoClaw terminal contracts, and persisted voice artifacts.

- [x] **Step 1: Add failing UI tests for camera empty/connected states and inventory workflow creation.**
- [x] **Step 2: Add protocol-boundary tests for each locally testable adapter behavior.**
- [x] **Step 3: Make only the minimal accessibility/configuration changes required by those tests.**
- [x] **Step 4: Run the full local acceptance command and document the exact external-only checklist.**

### Task 5: Final evidence and scope audit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-12-close-local-acceptance-gaps.md`

**Interfaces:**
- Consumes: outputs from Tasks 1-4.
- Produces: checked task boxes plus an explicit list of external verification still requiring user resources.

- [x] **Step 1: Run `make check` from a clean command invocation.**
- [x] **Step 2: Inspect `git diff --check` and the scoped diff.**
- [x] **Step 3: Mark only evidenced checklist items complete.**
- [x] **Step 4: Report remaining external dependencies without presenting them as fixed.**
