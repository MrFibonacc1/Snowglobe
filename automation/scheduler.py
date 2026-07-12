"""Scheduled (cron) workflows + log aggregation.

A workflow whose trigger is {"type": "schedule", "cron": "0 9 * * *",
"lookback_hours": 24, "event_type": "foot_traffic"} runs on a cron cadence.
When it fires, we aggregate the recent event log over the lookback window and
hand the summary to the steps as the "event" — so an agent can act on
"the last 24h of human traffic" rather than a single detection.
"""

import asyncio
import uuid
from datetime import datetime, timezone

import engine
import storage

_MINUTE_CACHE: set[str] = set()  # (workflow_id, YYYYMMDDHHMM) already fired


# --- minimal 5-field cron matcher (min hour dom mon dow) -------------------

def _field_match(field: str, value: int) -> bool:
    field = field.strip()
    if field == "*":
        return True
    for part in field.split(","):
        part = part.strip()
        if part.startswith("*/"):
            try:
                if value % int(part[2:]) == 0:
                    return True
            except ValueError:
                continue
        elif "-" in part:
            a, _, b = part.partition("-")
            if a.isdigit() and b.isdigit() and int(a) <= value <= int(b):
                return True
        elif part.isdigit() and int(part) == value:
            return True
    return False


def cron_matches(cron: str, dt: datetime) -> bool:
    parts = cron.split()
    if len(parts) != 5:
        return False
    minute, hour, dom, mon, dow = parts
    cron_dow = dt.isoweekday() % 7  # cron: 0/7 = Sunday, 1 = Monday …
    return (
        _field_match(minute, dt.minute)
        and _field_match(hour, dt.hour)
        and _field_match(dom, dt.day)
        and _field_match(mon, dt.month)
        and _field_match(dow, cron_dow)
    )


# --- aggregation -----------------------------------------------------------

def aggregate(lookback_hours: float, event_type: str | None = None) -> dict:
    """Summarize the event log over the last `lookback_hours`.

    total_events, total_count (sum of payload.count), per-zone breakdown and
    the busiest zone — filtered to `event_type` when given (and not '*')."""
    now = datetime.now(timezone.utc).timestamp()
    cutoff = now - lookback_hours * 3600
    filt = event_type if event_type and event_type != "*" else None
    total_events = 0
    total_count = 0.0
    by_zone: dict[str, float] = {}
    for e in storage.list_events(5000):
        try:
            ts = datetime.fromisoformat(e["timestamp"]).timestamp()
        except (ValueError, KeyError):
            continue
        if ts < cutoff:
            continue
        if filt and e.get("event_type") != filt:
            continue
        total_events += 1
        c = (e.get("payload") or {}).get("count")
        inc = c if isinstance(c, (int, float)) else 1
        total_count += inc
        by_zone[e.get("location", "?")] = by_zone.get(e.get("location", "?"), 0) + inc
    busiest = max(by_zone, key=by_zone.get) if by_zone else None
    return {
        "window_hours": lookback_hours,
        "event_type": filt or "all",
        "total_events": total_events,
        "total_count": int(total_count),
        "by_zone": {k: int(v) for k, v in by_zone.items()},
        "busiest_zone": busiest,
    }


def build_summary_event(workflow: dict) -> dict:
    t = workflow.get("trigger", {})
    summary = aggregate(
        float(t.get("lookback_hours", 24)),
        t.get("event_type"),
    )
    return {
        "event_id": f"evt_sched_{uuid.uuid4().hex[:8]}",
        "event_type": t.get("summary_event_type") or "traffic_summary",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "confidence": 1.0,
        "location": "all",
        "payload": summary,
    }


async def run_scheduled(workflow: dict) -> str:
    """Fire one run of a schedule workflow now, over its lookback window."""
    event = build_summary_event(workflow)
    storage.insert_event(event)
    run = engine._new_run(workflow, event)
    storage.insert_run(run)
    asyncio.create_task(engine.execute_run(run, workflow, event))
    return run["id"]


def is_schedule(workflow: dict) -> bool:
    return (workflow.get("trigger") or {}).get("type") == "schedule"


# --- the loop --------------------------------------------------------------

async def loop(poll_sec: int = 30) -> None:
    """Every poll_sec, fire any enabled schedule workflow whose cron matches
    the current minute (once per minute, deduped)."""
    while True:
        try:
            now = datetime.now()
            stamp = now.strftime("%Y%m%d%H%M")
            for wf in storage.list_workflows():
                if not wf.get("enabled") or not is_schedule(wf):
                    continue
                cron = (wf.get("trigger") or {}).get("cron", "")
                key = f"{wf['id']}:{stamp}"
                if key in _MINUTE_CACHE:
                    continue
                if cron_matches(cron, now):
                    _MINUTE_CACHE.add(key)
                    await run_scheduled(wf)
            # keep the dedupe cache small
            if len(_MINUTE_CACHE) > 2000:
                _MINUTE_CACHE.clear()
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            print(f"[scheduler] tick error: {exc}")
        await asyncio.sleep(poll_sec)
