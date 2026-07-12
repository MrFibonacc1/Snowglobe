# Real Inventory Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the httpbin stock-update stand-in with an idempotent, persisted inventory decrement executed by the workflow engine.

**Architecture:** SQLite gains inventory items and an append-only adjustment ledger. A first-class `inventory_adjust` step atomically changes stock once per event/SKU, returns before/after counts, and fails on unknown SKUs. The seeded retail workflow performs this real mutation before notification.

**Tech Stack:** Python 3, SQLite transactions, FastAPI, React/TypeScript, `unittest`.

## Global Constraints

- Never decrement the same SKU twice for the same event.
- Never silently mutate an unknown SKU or allow stock below zero.
- Runs expose `sku`, `before`, `after`, `delta`, and `applied`.
- Remove all claims that httpbin form submission is a stock update.

---

### Task 1: Durable inventory domain

**Files:** Modify `automation/storage.py`; create `automation/tests/test_inventory.py`.

**Interfaces:** `upsert_inventory(item: dict)`, `list_inventory()`, `adjust_inventory(sku: str, delta: int, event_id: str) -> dict`.

- [x] Write transactional tests for decrement, duplicate-event idempotency, unknown SKU, and zero floor.
- [x] Verify RED because inventory tables/functions do not exist.
- [x] Add `inventory_items` and `inventory_adjustments` tables plus atomic adjustment logic.
- [x] Verify focused tests pass.

### Task 2: Workflow step and API

**Files:** Create `automation/steps/inventory.py`; modify `automation/steps/__init__.py`, `automation/main.py`, `automation/seeds.py`, `shared/workflow_schema.json`; create `automation/tests/test_inventory_step.py`.

**Interfaces:** step config `{sku: str, delta: int}`; `GET /inventory`; `PUT /inventory/{sku}`.

- [x] Write a failing step test showing event `event_id` makes adjustment idempotent.
- [x] Implement the executor and inventory routes.
- [x] Replace `wf_stock_update` httpbin agent step with `inventory_adjust` using SKU `front-shelf-item` and delta `-1`.
- [x] Verify seed and engine integration tests pass.

### Task 3: Builder and Runs UI

**Files:** Modify `dashboard/src/types.ts`, `dashboard/src/pages/WorkflowBuilder.tsx`, `dashboard/src/pages/Runs.tsx`, `dashboard/src/mockData.ts`.

**Interfaces:** `StepType` includes `inventory_adjust`; builder edits `sku` and `delta`; Runs renders count transition.

- [x] Add inventory step selection/configuration and exact before-to-after run copy.
- [x] Run dashboard build; TypeScript and Vite PASS.
