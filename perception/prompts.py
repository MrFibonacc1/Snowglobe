"""Prompts for the perception VLM.

Two modes:

1. DISCOVER (default) — one open-ended prompt asks the model to surface any
   *actionable* event it sees in the frame and to name the event type itself.
   Types are NOT drawn from a fixed list; they emerge semantically from the
   scene (e.g. "spill", "blocked_fire_exit", "forklift_near_pedestrian",
   "unattended_bag"). The model returns a JSON array of findings.

2. TARGETED — a caller can still ask a yes/no question about one specific type
   string (arbitrary, caller-defined). Used by the Testing page and by anyone
   who wants to watch for a known concern.

Both modes keep a stable per-finding shape so vlm.py parses them one way:

    {"event_type": str, "detected": bool, "confidence": 0..1,
     "count": int|null, "detail": str|null}
"""

# Product context so the model only surfaces useful, actionable signals — the
# kinds of things an operations/facilities/safety team would want an automation
# to act on. This steers discovery away from trivia ("a person is standing").
PRODUCT_CONTEXT = (
    "This is an ambient monitoring product for physical spaces (retail floors, "
    "warehouses, restaurants, facilities). Downstream, each event you report "
    "can trigger an automated action: alerting staff, filing an incident, "
    "dispatching a cleanup, or notifying security. Only report events that are "
    "ACTIONABLE right now — something a staff member, security guard, or manager "
    "would get up and respond to. Examples of actionable: a spill or wet floor, "
    "a blocked or propped-open exit, a fall or person on the ground, a fight or "
    "aggression, a weapon, smoke or fire, an unattended bag, a long queue, "
    "overcrowding, a machine/vehicle too close to a person, an intrusion after "
    "hours, or a rapidly emptying/panicking crowd. Do NOT report inert objects, "
    "decor, or normal scene contents (Christmas trees, furniture, signage, "
    "plants, a person simply standing, shelves, ordinary foot traffic). If the "
    "scene looks normal and safe, return an empty list — that is the correct and "
    "expected answer most of the time."
)

SYSTEM = (
    "You are a computer-vision inspector for a physical-space monitoring "
    "system. You are shown a single video frame. Answer with ONLY compact JSON "
    "— no prose, no markdown, no explanation outside the JSON. If you are "
    "unsure, prefer fewer findings with honest, lower confidence."
)

# Shape hint for a single targeted verdict.
_VERDICT_HINT = (
    ' Respond with exactly this JSON and nothing else: '
    '{"detected": <true|false>, "confidence": <number 0..1>, '
    '"count": <integer or null>, "detail": <short string or null>}.'
)

# Shape hint for the open-ended discovery pass (an array of findings).
_DISCOVER_HINT = (
    ' Respond with ONLY a JSON array (possibly empty) of findings, each exactly '
    'like: {"event_type": <short snake_case label you choose, e.g. "spill", '
    '"blocked_exit", "person_on_ground", "overcrowding">, '
    '"severity": <"low"|"medium"|"high">, '
    '"confidence": <number 0..1>, "count": <integer or null, e.g. number of '
    'people involved>, "detail": <one short human-readable sentence>}. '
    'Choose the most specific, reusable event_type slug that describes each '
    'finding. Only include findings with severity "medium" or "high" — omit '
    'anything "low" or merely descriptive. Return [] if nothing actionable is '
    'present.'
)

DISCOVER = (
    PRODUCT_CONTEXT
    + " Examine this frame and list every actionable event you can identify."
    + _DISCOVER_HINT
)


def discover() -> str:
    """The open-ended discovery prompt."""
    return DISCOVER


def for_event(event_type: str) -> str:
    """A targeted yes/no prompt for an arbitrary, caller-defined event type.

    No fixed enum: the type slug is humanized and asked about directly, so any
    concern a user configures can be watched for.
    """
    label = event_type.replace("_", " ").strip()
    return (
        PRODUCT_CONTEXT
        + f" Focus only on this specific concern: '{label}'. Is it present in "
        f"this frame? Set detected=true only if you actually observe it, and "
        f"describe what you see. If it involves people or a quantity, set count."
        + _VERDICT_HINT
    )
