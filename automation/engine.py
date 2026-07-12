"""Workflow engine: trigger matching, cooldown, templating, run execution.

Runs execute as asyncio tasks so POST /events returns immediately. Step
executors are synchronous (subprocess / SDK calls) and run in a thread.
"""

import asyncio
import re
import uuid
from datetime import datetime, timezone

import storage
from steps import execute_step

_TEMPLATE_RE = re.compile(r"\{\{\s*(event|steps)\.([a-zA-Z0-9_.]+)\s*\}\}")


def _resolve_path(obj: dict, path: str):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def render(value, event: dict, steps: dict | None = None):
    """Resolve {{event.*}} and {{steps.<id>.<field>}} placeholders in strings,
    recursively for dict/list. `steps` maps completed step ids to their output,
    so later steps can use earlier results — e.g. an agent's answer:
    "Post to Slack: {{steps.s1.answer}}"."""
    roots = {"event": event, "steps": steps or {}}
    if isinstance(value, str):
        def _sub(m):
            # Only a missing path (None) becomes ""; falsy-but-real values
            # (0, 0.0, False) must render as themselves — a quiet-night count
            # of 0 should read "0 people", not "".
            resolved = _resolve_path(roots[m.group(1)], m.group(2))
            return "" if resolved is None else str(resolved)
        return _TEMPLATE_RE.sub(_sub, value)
    if isinstance(value, dict):
        return {k: render(v, event, steps) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, event, steps) for v in value]
    return value


def matches(workflow: dict, event: dict) -> bool:
    t = workflow["trigger"]
    # Schedule workflows are fired by the scheduler, never by incoming events.
    if t.get("type") == "schedule":
        return False
    event_type = t.get("event_type", "*")
    type_ok = event_type == "*" or event_type == event["event_type"]
    return (
        workflow.get("enabled", False)
        and type_ok
        and (not t.get("zone") or t["zone"] == event["location"])
        and event["confidence"] >= t.get("min_confidence", 0)
    )


def _cooldown_ok(workflow: dict, event: dict) -> bool:
    window = workflow["trigger"].get("cooldown_sec", 0)
    return storage.claim_cooldown(workflow["id"], event["location"], window)


def _new_run(workflow: dict, event: dict) -> dict:
    return {
        "id": f"run_{uuid.uuid4().hex[:10]}",
        "workflow_id": workflow["id"],
        "workflow_name": workflow["name"],
        "event": event,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "steps": [
            {"id": s["id"], "type": s["type"], "status": "pending"}
            for s in workflow["steps"]
        ],
    }


async def handle_event(event: dict) -> list[str]:
    """Match an event against all workflows; start a run per match."""
    run_ids = []
    for wf in storage.list_workflows():
        if matches(wf, event) and _cooldown_ok(wf, event):
            run = _new_run(wf, event)
            storage.insert_run(run)
            asyncio.create_task(execute_run(run, wf, event))
            run_ids.append(run["id"])
    return run_ids


async def execute_run(run: dict, workflow: dict, event: dict) -> None:
    """Execute steps sequentially, persisting per-step status as we go —
    the dashboard polls GET /runs to render this live."""
    failed = False
    for i, step_def in enumerate(workflow["steps"]):
        step = run["steps"][i]
        if failed:
            step["status"] = "skipped"
            storage.update_run(run)
            continue

        step["status"] = "running"
        step["started_at"] = datetime.now(timezone.utc).isoformat()
        storage.update_run(run)

        steps_ctx = {
            s["id"]: s.get("output", {}) for s in run["steps"] if s.get("output")
        }
        config = render(step_def.get("config", {}), event, steps_ctx)

        # Let long-running steps publish partial output mid-flight (e.g. the H
        # agent's live view URL) so the dashboard can show it working before the
        # step returns. Runs in the worker thread; only mutates the run dict and
        # writes storage (both sync + thread-safe here), never the event loop.
        def _progress(partial: dict, _step=step, _run=run) -> None:
            merged = dict(_step.get("output") or {})
            merged.update(partial or {})
            _step["output"] = merged
            storage.update_run(_run)

        try:
            output = await asyncio.to_thread(
                execute_step, step_def["type"], config, event, _progress
            )
            step["output"] = output
            # A condition step that doesn't pass ends the run quietly.
            if step_def["type"] == "condition" and not output.get("passed", True):
                step["status"] = "done"
                for later in run["steps"][i + 1 :]:
                    later["status"] = "skipped"
                storage.update_run(run)
                break
            step["status"] = "done"
        except Exception as exc:  # noqa: BLE001 — surface anything to the run log
            step["status"] = "failed"
            details = getattr(exc, "details", {})
            step["output"] = dict(details) if isinstance(details, dict) else {}
            step["output"]["error"] = str(exc)
            failed = True
        step["finished_at"] = datetime.now(timezone.utc).isoformat()
        storage.update_run(run)

    run["status"] = "failed" if failed else "done"
    run["finished_at"] = datetime.now(timezone.utc).isoformat()
    storage.update_run(run)
