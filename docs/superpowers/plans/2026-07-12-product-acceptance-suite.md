# Product Acceptance Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn currently unexercised builder, camera, event, voice, NemoClaw, and MCP surfaces into repeatable automated acceptance checks.

**Architecture:** Backend contract tests cover all step executors and representative discovery events. Vitest + Testing Library exercises WorkflowBuilder creation against an in-memory store. A synthetic video file provides a hardware-independent live-camera acceptance path while documentation retains a separate physical ONVIF checklist.

**Tech Stack:** Python `unittest`, Vitest, React Testing Library, jsdom, FastAPI test doubles, Gradium REST TTS.

## Global Constraints

- No executor may return stub success for an external action.
- Tests must not require paid external calls or physical camera hardware.
- Live-camera acceptance uses an actual decoded sample video stream, not mocked UI state.
- External live checks remain explicitly separate and credential-gated.

---

### Task 1: Voice, MCP, and NemoClaw contracts

**Files:** Modify `automation/steps/voice.py`; create `automation/tests/test_voice_step.py`, `automation/tests/test_mcp_step.py`, `automation/tests/test_nemoclaw_step.py`.

**Interfaces:** Gradium `POST https://api.gradium.ai/api/post/speech/tts` with `x-api-key`; voice output `{executed, provider, bytes, format}`.

- [x] Write failing tests for missing Gradium key, confirmed audio response, MCP tool error/success, and NemoClaw terminal/timeout behavior.
- [x] Replace voice stub with fail-closed Gradium REST synthesis using injected HTTP client and configured voice ID.
- [x] Verify all focused executor tests pass without network.

### Task 2: WorkflowBuilder UI acceptance

**Files:** Modify `dashboard/package.json`; create `dashboard/src/pages/WorkflowBuilder.test.tsx` and `dashboard/src/test/setup.ts`.

**Interfaces:** `npm run test` runs Vitest once under jsdom.

- [x] Install Vitest, jsdom, and React Testing Library.
- [x] Render WorkflowBuilder, create and save a workflow with a canonical discovery trigger, and assert the store received it.
- [x] Run `npm run test`; PASS. The test also found and fixed underscore loss while typing trigger slugs.

### Task 3: Camera and event matrix acceptance

**Files:** Create `perception/tests/test_camera_acceptance.py`, `perception/tests/test_event_matrix.py`; modify `docs/CAMERA_INTEGRATION.md`.

**Interfaces:** sample clip `sample_data/19_merl_shelf_interaction_1_1.mp4` is decoded through the real capture path.

- [x] Test that a real sample-video camera produces a decoded latest frame.
- [x] Test canonical parsing for spill, PPE, crowd, retail interaction, and grounded fall outputs.
- [x] Retain the physical ONVIF procedure in `docs/CAMERA_INTEGRATION.md`; hardware verification remains environment-specific.
- [x] Run all Python tests plus dashboard test/build.
