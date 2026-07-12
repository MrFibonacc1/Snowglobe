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
                    "text": "Spill detected in {{event.location}} "
                            "(confidence {{event.confidence}}), incident filed.",
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
                    "text": "{{event.payload.count}} people in "
                            "{{event.location}}, over capacity.",
                },
            },
        ],
    },
    # --- Crowd-traffic branching (two workflows, same trigger) ----------------
    # Both fire on foot_traffic; each gates on its own count threshold, so one
    # event routes to "busy" OR "quiet" behavior — the high/low branch.
    {
        "id": "wf_busy_zone",
        "name": "Busy zone → staff alert",
        "enabled": True,
        "trigger": {
            "event_type": "foot_traffic",
            "min_confidence": 0.5,
            "cooldown_sec": 60,
        },
        "steps": [
            {
                "id": "s1",
                "type": "condition",
                "config": {"expression": "payload.count > 30"},
            },
            {
                "id": "s2",
                "type": "composio",
                "config": {
                    "action": "slack_message",
                    "channel": "#floor",
                    "text": "High traffic in {{event.location}} "
                            "({{event.payload.count}} people) — send more staff.",
                },
            },
        ],
    },
    {
        "id": "wf_quiet_zone",
        "name": "Quiet zone → research goods (H agent)",
        "enabled": True,
        "trigger": {
            "event_type": "foot_traffic",
            "min_confidence": 0.5,
            "cooldown_sec": 60,
        },
        "steps": [
            {
                "id": "s1",
                "type": "condition",
                "config": {"expression": "payload.count < 10"},
            },
            {
                "id": "s2",
                "type": "h_agent",
                "config": {
                    "task": "custom_url",
                    "agent": "h/web-surfer-flash",
                    "share": True,
                    "instructions": (
                        "It's a slow period at the shop, so use the downtime to "
                        "research supplies. Search the web for the current "
                        "wholesale price of coffee beans, open a supplier or "
                        "pricing page, and report the typical price per pound "
                        "with the source URL."
                    ),
                },
            },
        ],
    },
    {
        "id": "wf_stock_update",
        "name": "Item taken off shelf → restock + alert",
        "enabled": True,
        "trigger": {
            "event_type": "item_removed_from_shelf",
            "min_confidence": 0.5,
            "cooldown_sec": 30,
        },
        "steps": [
            {"id": "s1", "type": "inventory_adjust", "config": {
                "sku": "front-shelf-item", "delta": -1,
            }},
            {
                "id": "s2",
                "type": "composio",
                "config": {
                    "action": "slack_message",
                    "channel": "#store-ops",
                    "text": "Stock updated for front-shelf-item in "
                            "{{event.location}}: {{steps.s1.before}} → "
                            "{{steps.s1.after}}.",
                },
            },
        ],
    },
    # --- Shopper picks up merchandise → agent files restock ------------------
    # Fires on the open-ended `person_interaction` event the perception model
    # surfaces in discovery mode when someone takes an item off a shelf. This is
    # the "upload a video in Testing → agent actually runs" demo path: no need to
    # pre-select a targeted event slug, discovery-mode detection routes straight
    # to the H agent.
    {
        "id": "wf_shopper_interaction",
        "name": "Shopper handles merchandise → restock (H agent)",
        "enabled": True,
        "trigger": {
            "event_type": "person_interaction",
            "min_confidence": 0.5,
            "cooldown_sec": 30,
        },
        "steps": [
            {
                "id": "s1",
                "type": "h_agent",
                "config": {
                    "agent": "h/web-surfer-flash",
                    "task": "custom_url",
                    # Real, always-up HTML form standing in for a store restock
                    # portal so the demo never depends on a private URL.
                    "url": "https://httpbin.org/forms/post",
                    "timeout_sec": 150,
                    "instructions": (
                        "You are logging a store restock request after a shopper "
                        "handled merchandise. On this form, set Customer name to "
                        "'Snowglobe Restock Bot', and in the 'Comments' box type "
                        "exactly: 'RESTOCK CHECK — {{event.payload.detail}} in "
                        "{{event.location}} (confidence {{event.confidence}})'. "
                        "Then click Submit order. Report back the JSON the server "
                        "echoes, confirming the comments field contains the "
                        "message. Work quickly; do not fill optional fields."
                    ),
                },
            },
            {
                "id": "s2",
                "type": "composio",
                "config": {
                    "action": "slack_message",
                    "channel": "#store-ops",
                    "text": "Shopper interaction in {{event.location}}: "
                            "{{event.payload.detail}} (confidence "
                            "{{event.confidence}}). Agent logged a restock check. "
                            "Agent report: {{steps.s1.answer}}",
                },
            },
        ],
    },
    # --- Voice alert (Gradium TTS) → modular delivery -------------------------
    # Speech is a primitive: s1 synthesizes a spoken alert (and plays it aloud
    # on the demo box); s2 delivers the resulting audio_url wherever we want —
    # here Slack, but it could be Drive, email, or an MCP tool. The delivery is
    # chosen per use-case, not baked into the voice step.
    {
        "id": "wf_spill_voice",
        "name": "Spill → spoken alert (Gradium) + Slack",
        "enabled": True,
        "trigger": {
            "event_type": "spill",
            "min_confidence": 0.7,
            "cooldown_sec": 300,
        },
        "steps": [
            {
                "id": "s1",
                "type": "voice",
                "config": {
                    "text": "Attention: a spill was detected in "
                            "{{event.location}}. Please dispatch cleanup.",
                    "play_local": True,
                },
            },
            {
                "id": "s2",
                "type": "composio",
                "config": {
                    "action": "slack_message",
                    "channel": "#facilities-alerts",
                    "text": "Spoken spill alert for {{event.location}} "
                            "(confidence {{event.confidence}}). "
                            "Audio: {{steps.s1.audio_url}}",
                },
            },
        ],
    },
]
