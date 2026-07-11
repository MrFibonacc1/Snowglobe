"""Workflow engine: trigger matching, cooldown, templating, run execution.

Runs execute as asyncio tasks so POST /events returns immediately. Step
executors are synchronous (subprocess / SDK calls) and run in a thread.
"""

import asyncio
import re
import time
import uuid
from datetime import datetime, timezone

import storage
from steps import execute_step

# (workflow_id, location) -> last fire timestamp. In-memory: restart clears
# cooldowns, which is fine for a hackathon.
_last_fire: dict[tuple[str, str], float] = {}

_TEMPLATE_RE = re.compile(r"\{\{\s*event\.([a-zA-Z0-9_.]+)\s*\}\}")


def _resolve_path(obj: dict, path: str):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def render(value, event: dict):
    """Resolve {{event.*}} placeholders in strings, recursively for dict/list."""
    if isinstance(value, str):
        return _TEMPLATE_RE.sub(
            lambda m: str(_resolve_path(event, m.group(1)) or ""), value
        )
    if isinstance(value, dict):
        return {k: render(v, event) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, event) for v in value]
    return value


def matches(workflow: dict, event: dict) -> bool:
    t = workflow["trigger"]
    return (
        workflow.get("enabled", False)
        and t["event_type"] == event["event_type"]
        and (not t.get("zone") or t["zone"] == event["location"])
        and event["confidence"] >= t["min_confidence"]
    )


def _cooldown_ok(workflow: dict, event: dict) -> bool:
    key = (workflow["id"], event["location"])
    window = workflow["trigger"].get("cooldown_sec", 0)
    now = time.time()
    if now - _last_fire.get(key, 0) < window:
        return False
    _last_fire[key] = now
    return True


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

        config = render(step_def.get("config", {}), event)
        try:
            output = await asyncio.to_thread(
                execute_step, step_def["type"], config, event
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
            step["output"] = {"error": str(exc)}
            failed = True
        step["finished_at"] = datetime.now(timezone.utc).isoformat()
        storage.update_run(run)

    run["status"] = "failed" if failed else "done"
    run["finished_at"] = datetime.now(timezone.utc).isoformat()
    storage.update_run(run)
