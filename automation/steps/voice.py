"""Voice step (stretch, Gradium Challenge) — speak a templated alert.

Stub until we get Gradium API details at the event; the step contract is
stable so workflows can already include it.

config: { "text": "Spill detected in {{event.location}}" }
"""

import os


def execute(config: dict, event: dict) -> dict:
    text = config.get("text", "")
    if not os.environ.get("GRADIUM_API_KEY"):
        print(f"[voice stub] would speak: {text}")
        return {"stubbed": True, "text": text}
    # TODO(hackathon): wire Gradium TTS once we have docs/credits at the event.
    return {"stubbed": True, "text": text, "note": "Gradium client not implemented yet"}
