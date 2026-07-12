"""First-class, durable inventory mutations."""

import storage


def execute(config: dict, event: dict) -> dict:
    sku = str(config.get("sku") or event.get("payload", {}).get("sku") or "").strip()
    if not sku:
        raise ValueError("inventory_adjust needs config.sku or event.payload.sku")
    if "event_id" not in event:
        raise ValueError("inventory_adjust needs event.event_id for idempotency")
    delta = int(config.get("delta", -1))
    return storage.adjust_inventory(sku, delta, event["event_id"])
