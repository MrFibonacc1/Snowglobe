"""Natural-language → workflow generator.

Turns a plain-English description ("when there's a spill, log time and location
to my google doc") into a valid Snowglobe workflow (see shared/workflow_schema).

Uses an OpenAI-compatible LLM (NVIDIA NIM / Nemotron by default, same key as
perception). Falls back to a keyword heuristic if no LLM key or the call fails,
so the chat always returns something usable.
"""

import json
import os
import re
import uuid

import httpx

LLM_BASE_URL = (
    os.environ.get("LLM_BASE_URL")
    or os.environ.get("VLM_BASE_URL")
    or "https://integrate.api.nvidia.com/v1"
)
LLM_MODEL = os.environ.get("LLM_MODEL") or os.environ.get("VLM_MODEL") or "nvidia/nemotron-nano-12b-v2-vl"
LLM_API_KEY = os.environ.get("NVIDIA_API_KEY") or os.environ.get("LLM_API_KEY")

_SYSTEM = """You convert a plain-English request into ONE Snowglobe automation \
workflow, returned as a single JSON object and NOTHING else (no prose, no \
markdown fences).

A workflow reacts to a camera-detected event and runs ordered steps.

Shape:
{
  "name": "<short title>",
  "enabled": true,
  "trigger": { "event_type": "<snake_case slug>", "zone": "<optional zone>",
               "min_confidence": 0.0-1.0, "cooldown_sec": <int seconds> },
  "steps": [ <step>, ... ]
}

event_type is an open-ended snake_case slug describing the physical event, e.g.
spill, person_count, foot_traffic, safety_violation, blocked_exit, low_stock,
missing_ppe. Use "*" to match any event. Omit "zone" unless the user names one.

SCHEDULE (cron) triggers: if the request is time-based ("every day at 9am",
"each morning", "hourly", "check the last 24 hours"), use a schedule trigger
instead:
  "trigger": { "type": "schedule", "cron": "0 9 * * *", "lookback_hours": 24,
               "event_type": "<optional filter, e.g. foot_traffic, or omit>" }
cron is 5 fields (min hour dom mon dow); "0 9 * * *" = daily 09:00. On each run
the engine aggregates the event log over lookback_hours and gives steps a
summary event with: {{event.payload.total_events}}, {{event.payload.total_count}}
(e.g. total people), {{event.payload.busiest_zone}}, {{event.payload.window_hours}}.
For "all human traffic" set event_type to "foot_traffic" (or "person_count").

Step types and their config:
- h_agent  -> a computer-use agent that drives a web browser. config:
    { "agent": "store-agent-speed" | "h/deep-search-pro",
      "task": "custom_url" | "google_form" | "ticket",
      "url": "<optional target url>",
      "instructions": "<what to do; use {{event.location}}, {{event.timestamp}}, {{event.payload.count}}, {{event.payload.detail}}>",
      "share": true }
    Use store-agent-speed (our custom shop agent) for interacting with apps/sites
    and filling forms/docs; use h/deep-search-pro only for open-ended research.
- composio -> an API action. config: { "action": "slack_message", "channel": "#alerts", "text": "..." }
    (also drive_upload / sheets_append).
- condition -> gate the run. config: { "expression": "payload.count > 20" }  (ops: > < >= <= == !=)
    Put a condition FIRST when the user says "if busy/quiet/over/under/more than N".
- mcp -> call any MCP tool. config: { "server_url": "...", "tool": "...", "arguments": {} }
- voice -> spoken alert. config: { "text": "..." }
- inventory_adjust -> persisted stock mutation. config: { "sku": "front-shelf-item", "delta": -1 }

Every step needs an "id" (s1, s2, ...) and a "type" and a "config".

Example — "when there's a spill, log the time and location to my google doc":
{"name":"Spill → log to Google Doc","enabled":true,
 "trigger":{"event_type":"spill","min_confidence":0.6,"cooldown_sec":60},
 "steps":[{"id":"s1","type":"h_agent","config":{"agent":"store-agent-speed","task":"custom_url",
   "url":"<google doc url>","share":true,
   "instructions":"Open the doc and append a line: Spill at {{event.timestamp}} in {{event.location}}."}}]}

Example — "every day at 9am, check the last 24h of foot traffic and email me a summary":
{"name":"Daily 9am foot-traffic digest","enabled":true,
 "trigger":{"type":"schedule","cron":"0 9 * * *","lookback_hours":24,"event_type":"foot_traffic"},
 "steps":[{"id":"s1","type":"h_agent","config":{"agent":"store-agent-speed","task":"custom_url",
   "instructions":"Compose a summary: {{event.payload.total_count}} people across {{event.payload.window_hours}}h, busiest zone {{event.payload.busiest_zone}}. Email it to the manager."}}]}

Return ONLY the JSON object."""


def generate_workflow(description: str) -> dict:
    wf = None
    if LLM_API_KEY:
        try:
            wf = _normalize(_extract_json(_call_llm(description)), description)
        except Exception as exc:  # noqa: BLE001 — fall back, never hard-fail the chat
            print(f"[generate] LLM path failed ({exc}); using heuristic")
            wf = None
    if wf is None:
        wf = _heuristic(description)
    return wf


def _call_llm(description: str) -> str:
    r = httpx.post(
        f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {LLM_API_KEY}"},
        json={
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": description},
            ],
            "temperature": 0.2,
            "max_tokens": 900,
        },
        timeout=90,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def _extract_json(text: str) -> dict:
    text = _THINK_RE.sub("", text)
    # find the first balanced {...}
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in LLM output")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("unbalanced JSON in LLM output")


_CRON_RE = re.compile(r"^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$")


def _normalize(wf: dict, description: str) -> dict:
    """Coerce an LLM object into a schema-valid workflow."""
    trig = wf.get("trigger") or {}
    schedule = trig.get("type") == "schedule" or bool(trig.get("cron")) or _looks_scheduled(description)

    if schedule:
        cron = trig.get("cron") if isinstance(trig.get("cron"), str) and _CRON_RE.match(trig["cron"]) else _guess_cron(description)
        norm_trigger: dict = {
            "type": "schedule",
            "cron": cron,
            "lookback_hours": _num(trig.get("lookback_hours"), 24),
        }
        et = trig.get("event_type")
        if et:
            norm_trigger["event_type"] = _slug(et)
        if trig.get("zone"):
            norm_trigger["zone"] = str(trig["zone"])
    else:
        norm_trigger = {
            "event_type": _slug(trig.get("event_type") or _guess_event(description)),
            "min_confidence": _num(trig.get("min_confidence"), 0.6),
            "cooldown_sec": int(_num(trig.get("cooldown_sec"), 60)),
        }
        if trig.get("zone"):
            norm_trigger["zone"] = str(trig["zone"])

    steps = []
    for i, s in enumerate(wf.get("steps") or [], start=1):
        stype = s.get("type")
        if stype not in ("h_agent", "composio", "condition", "mcp", "voice", "inventory_adjust"):
            continue
        steps.append({"id": s.get("id") or f"s{i}", "type": stype, "config": s.get("config") or {}})
    if not steps:
        steps = _heuristic(description)["steps"]

    return {
        "id": f"wf_{uuid.uuid4().hex[:8]}",
        "name": str(wf.get("name") or _title(description)),
        "enabled": bool(wf.get("enabled", True)),
        "trigger": norm_trigger,
        "steps": steps,
    }


# --- heuristic fallback ----------------------------------------------------

_EVENT_HINTS = [
    (r"spill|leak|liquid|wet", "spill"),
    (r"busy|crowd|traffic|queue|line|foot", "foot_traffic"),
    (r"occupan|capacity|people|person", "person_count"),
    (r"stock|shelf|empty|inventory|restock", "low_stock"),
    (r"ppe|helmet|hard ?hat|hairnet", "missing_ppe"),
    (r"exit|blocked|fire", "blocked_exit"),
    (r"safety|hazard|violation", "safety_violation"),
]


def _guess_event(text: str) -> str:
    low = text.lower()
    for pat, ev in _EVENT_HINTS:
        if re.search(pat, low):
            return ev
    return "*"


_SCHEDULE_RE = re.compile(
    r"every day|each day|daily|each morning|every morning|each night|nightly|"
    r"hourly|every hour|every \d+ ?(min|minute|hour)|weekly|每|at \d{1,2}\s*(am|pm|:)|schedule|cron",
    re.IGNORECASE,
)


def _looks_scheduled(text: str) -> bool:
    return bool(_SCHEDULE_RE.search(text or ""))


def _guess_cron(text: str) -> str:
    low = (text or "").lower()
    m = re.search(r"every\s+(\d+)\s*(min|minute)", low)
    if m:
        return f"*/{max(5, int(m.group(1)))} * * * *"
    if re.search(r"hourly|every hour", low):
        return "0 * * * *"
    # "at 9am", "9 am", "at 9", "9:30am"
    m = re.search(r"(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", low)
    if m and ("am" in low or "pm" in low or "at " in low):
        hour = int(m.group(1)) % 12
        if m.group(3) == "pm":
            hour += 12
        minute = int(m.group(2) or 0)
        return f"{minute} {hour} * * *"
    return "0 9 * * *"  # sensible default: daily 09:00


def _heuristic(description: str) -> dict:
    low = description.lower()
    event_type = _guess_event(description)
    steps = []
    sid = 1

    # low/high gate
    m = re.search(r"(?:over|more than|above|>)\s*(\d+)", low)
    if m:
        steps.append({"id": f"s{sid}", "type": "condition", "config": {"expression": f"payload.count > {m.group(1)}"}})
        sid += 1
    elif re.search(r"quiet|slow|low|under|below|fewer", low):
        steps.append({"id": f"s{sid}", "type": "condition", "config": {"expression": "payload.count < 10"}})
        sid += 1

    # action
    if re.search(r"research|find|look up|compare|price", low):
        steps.append({"id": f"s{sid}", "type": "h_agent", "config": {
            "agent": "h/deep-search-pro", "task": "custom_url", "share": True,
            "instructions": f"Research this and report findings: {description}",
        }})
    elif re.search(r"doc|document|log|record|form|portal|ticket|website|order|update", low):
        steps.append({"id": f"s{sid}", "type": "h_agent", "config": {
            "agent": "store-agent-speed", "task": "custom_url", "share": True,
            "instructions": (
                f"{description}. Include the event details: time {{{{event.timestamp}}}}, "
                "location {{event.location}}, detail {{event.payload.detail}}."
            ),
        }})
    else:
        steps.append({"id": f"s{sid}", "type": "composio", "config": {
            "action": "slack_message", "channel": "#alerts",
            "text": f"{event_type} in {{{{event.location}}}} ({{{{event.confidence}}}})",
        }})

    return {
        "id": f"wf_{uuid.uuid4().hex[:8]}",
        "name": _title(description),
        "enabled": True,
        "trigger": {"event_type": event_type, "min_confidence": 0.6, "cooldown_sec": 60},
        "steps": steps,
    }


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")
    return s or "*"


def _num(v, default):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _title(description: str) -> str:
    t = description.strip().rstrip(".")
    return (t[:48] + "…") if len(t) > 49 else (t or "New workflow")
