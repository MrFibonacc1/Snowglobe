# Agent Terminal Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never report an H agent workflow step as done, or execute dependent steps, unless the agent reached a terminal state and returned a usable answer.

**Architecture:** Define a typed `AgentExecutionError` at the H-agent boundary and validate every real backend result before returning it to the workflow engine. Preserve session/replay/status diagnostics on failures so the Runs UI explains the cutoff, while relying on the engine's existing fail-and-skip sequencing to prevent blank templated values from reaching Slack or other actions.

**Tech Stack:** Python 3, FastAPI workflow engine, H Agent HTTP/MCP APIs, A2A, `unittest`.

## Global Constraints

- A running, queued, or otherwise non-terminal agent response must never become `step.status == "done"`.
- A terminal real-agent response without a non-empty answer must fail closed.
- Dependent workflow steps must be skipped after agent failure.
- Failure output must retain safe session, replay, backend, status, step-count, and duration diagnostics.
- Mock mode remains usable for keyless UI demonstrations and is not evidence of external execution.

---

### Task 1: Enforce the real-agent completion contract

**Files:**
- Create: `automation/tests/test_h_agent.py`
- Modify: `automation/steps/h_agent.py`

**Interfaces:**
- Produces: `AgentExecutionError(message: str, details: dict)` for unfinished or answerless real-agent results.
- Produces: `_require_terminal_answer(output: dict, running_states: set[str]) -> dict`, returning only terminal results with a non-empty answer.

- [x] **Step 1: Write regression tests** for a timed-out `status=running` response, a terminal response with no answer, and a completed response with an answer.
- [x] **Step 2: Run `python3 -m unittest automation/tests/test_h_agent.py -v`** and verify the timeout and missing-answer expectations fail against the current normal-return behavior.
- [x] **Step 3: Implement `AgentExecutionError` and `_require_terminal_answer`**, retaining safe diagnostic fields in `details`.
- [x] **Step 4: Route `agent_api`, `agent_mcp`, and `nemoclaw` outputs through the validator; leave `mock` unchanged.**
- [x] **Step 5: Re-run the focused tests and require all cases to pass.**

### Task 2: Persist diagnostics and stop dependent actions

**Files:**
- Modify: `automation/engine.py`
- Modify: `automation/tests/test_engine.py`
- Modify: `dashboard/src/pages/Runs.tsx`

**Interfaces:**
- Consumes: exceptions with an optional `details: dict` attribute.
- Produces: failed step output containing `error` plus safe diagnostics; subsequent steps remain `skipped` and the run becomes `failed`.

- [x] **Step 1: Add a regression test** where an H-agent timeout carries session diagnostics and a downstream Slack step would consume `{{steps.s1.answer}}`.
- [x] **Step 2: Run the test and verify diagnostics are currently discarded.**
- [x] **Step 3: Merge typed exception details into failed-step output without overwriting `error`.**
- [x] **Step 4: Surface retained replay/session diagnostics for failed agent steps in Runs.**
- [x] **Step 5: Run the full Python suite and dashboard production build.**

### Task 3: Document and live-check the timeout behavior

**Files:**
- Modify: `automation/NOTES.md`
- Modify: `automation/README.md`

**Interfaces:**
- Documents: `H_AGENT_TIMEOUT_SEC`, per-step `timeout_sec`, failure semantics, and replay-based diagnosis.

- [x] **Step 1: Document that timeout is a hard workflow failure, not a successful partial result.**
- [x] **Step 2: Document that longer legitimate missions should raise the explicit per-step budget rather than accepting partial output.**
- [ ] **Step 3: Run the available live H connection diagnostic and report whether the current account finishes a small task within budget.**
- [x] **Step 4: Mark plan checkboxes with verified results.**

## Verification result (2026-07-12)

- The original regression failed as expected: `status=running` at 150 seconds and a terminal response without an answer both returned normally.
- After implementation, all 14 Python tests pass.
- Dashboard TypeScript and Vite production build pass.
- `git diff --check` passes.
- The live H diagnostic was interrupted before it returned a result; this does not affect the completed code or automated verification.
