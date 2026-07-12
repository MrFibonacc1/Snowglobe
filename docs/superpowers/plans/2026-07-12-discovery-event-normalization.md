# Discovery Event Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make open-ended discovery emit stable canonical event types that reliably match workflows while suppressing unsupported high-risk findings.

**Architecture:** A shared canonicalization policy maps model synonyms into a small operational taxonomy while retaining the model's raw label in event payloads. Perception applies it to discovery verdicts; automation applies the same policy at ingress as a trust boundary. High-risk `person_on_ground` findings require independent grounding before emission.

**Tech Stack:** Python 3, Cosmos-compatible VLM parsing, FastAPI, `unittest`.

## Global Constraints

- Targeted and discovery modes use the same canonical event slugs.
- Unknown actionable event types remain extensible and are slugified rather than dropped.
- The original model label is retained as `payload.raw_event_type` when normalization changes it.
- `person_on_ground` is not emitted unless `grounded is True`.

---

### Task 1: Canonical taxonomy

**Files:** Create `shared/event_normalization.py`; create `perception/tests/test_event_normalization.py`; modify `perception/vlm.py` and `perception/fusion.py`.

**Interfaces:** `canonical_event_type(value: str) -> str`; `normalize_verdict(verdict: Verdict) -> Verdict | None`.

- [x] Write tests proving retail-action aliases normalize to `item_removed_from_shelf`.
- [x] Run `python3 -m unittest perception/tests/test_event_normalization.py -v`; verify RED because the policy does not exist.
- [x] Implement exact alias rules and preserve `raw_event_type` on `Verdict`.
- [x] Add the grounded-only rule for `person_on_ground` after fusion.
- [x] Re-run focused tests; PASS.

### Task 2: Normalize at automation ingress

**Files:** Modify `automation/main.py`; create `automation/tests/test_event_ingress.py`.

**Interfaces:** `normalize_event(event: dict) -> dict` returns a copy with canonical `event_type` and optional `payload.raw_event_type`.

- [x] Write an API-boundary unit test proving a discovery alias matches a canonical workflow.
- [x] Verify RED against the current exact-string matcher.
- [x] Normalize before persistence and workflow dispatch.
- [x] Verify focused and full Python suites pass.
