"""One prompt per event type. Each asks the VLM for a compact JSON verdict.

Keep the verdict shape identical across event types so vlm.py can parse them
with one code path:

    {"detected": bool, "confidence": 0..1, "count": int|null, "detail": str|null}
"""

EVENT_TYPES = ["spill", "person_count", "foot_traffic", "safety_violation"]

SYSTEM = (
    "You are a computer-vision inspector for a physical-space monitoring "
    "system. You are shown a single video frame and must answer with ONLY a "
    "compact JSON object — no prose, no markdown, no explanation outside the "
    "JSON. If you are unsure, set detected to false with a low confidence."
)

# Appended to every prompt so the model always returns the same shape.
_SCHEMA_HINT = (
    ' Respond with exactly this JSON and nothing else: '
    '{"detected": <true|false>, "confidence": <number 0..1>, '
    '"count": <integer or null>, "detail": <short string or null>}.'
)

EVENT_PROMPTS = {
    "spill": (
        "Look at the floor in this frame. Is there a liquid spill, puddle, "
        "wet patch, or leaked substance on the floor? Report detected=true "
        "only for an actual spill, not shadows, floor markings, or rugs."
        + _SCHEMA_HINT
    ),
    "person_count": (
        "Count the people visible in this frame. Set detected=true if at "
        "least one person is present and count to the number of people you "
        "can see."
        + _SCHEMA_HINT
    ),
    "foot_traffic": (
        "Estimate how many people are moving through this area in the frame "
        "(pedestrian throughput). Set count to that estimate and detected="
        "true if anyone is moving through."
        + _SCHEMA_HINT
    ),
    "safety_violation": (
        "Inspect this frame for a workplace safety violation: a person "
        "without required PPE (hard hat, high-visibility vest), a blocked or "
        "obstructed emergency exit, or an obvious hazard. Describe the "
        "specific violation in detail."
        + _SCHEMA_HINT
    ),
}


def for_event(event_type: str) -> str:
    try:
        return EVENT_PROMPTS[event_type]
    except KeyError:
        raise ValueError(f"Unknown event_type: {event_type!r}")
