"""Workflows seeded on first boot so the dashboard has real data immediately."""

WORKFLOWS = [
    {
        "id": "wf_spill_incident",
        "name": "Spill → incident report",
        "enabled": True,
        "trigger": {
            "event_type": "spill",
            "min_confidence": 0.7,
            "cooldown_sec": 300,
        },
        "steps": [
            {
                "id": "s1",
                "type": "h_agent",
                "config": {
                    "task": "google_form",
                    "url": "https://forms.gle/REPLACE_WITH_REAL_FORM",
                    "instructions": (
                        "Fill the facilities incident form. Location: "
                        "{{event.location}}. Time: {{event.timestamp}}. "
                        "Description: {{event.payload.detail}}. Severity: high. "
                        "Then submit the form."
                    ),
                },
            },
            {
                "id": "s2",
                "type": "composio",
                "config": {
                    "action": "slack_message",
                    "channel": "#facilities-alerts",
                    "text": "🚨 Spill detected in {{event.location}} "
                            "(confidence {{event.confidence}}) — incident filed.",
                },
            },
        ],
    },
    {
        "id": "wf_occupancy",
        "name": "Over capacity → occupancy alert",
        "enabled": True,
        "trigger": {
            "event_type": "person_count",
            "min_confidence": 0.6,
            "cooldown_sec": 120,
        },
        "steps": [
            {
                "id": "s1",
                "type": "condition",
                "config": {"expression": "payload.count > 20"},
            },
            {
                "id": "s2",
                "type": "composio",
                "config": {
                    "action": "slack_message",
                    "channel": "#facilities-alerts",
                    "text": "👥 {{event.payload.count}} people in "
                            "{{event.location}} — over capacity.",
                },
            },
        ],
    },
]
