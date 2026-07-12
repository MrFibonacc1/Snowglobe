"""Canonical event semantics shared by perception and automation."""

import copy
import re


_ALIASES = {
    "person_holding_item": "item_removed_from_shelf",
    "person_interaction": "item_removed_from_shelf",
    "object_interaction": "item_removed_from_shelf",
    "item_pickup": "item_removed_from_shelf",
    "person_picking_up_item": "item_removed_from_shelf",
    "product_interaction": "item_removed_from_shelf",
    "product_taken_from_shelf": "item_removed_from_shelf",
    "shelf_item_removed": "item_removed_from_shelf",
    "taking_item_from_shelf": "item_removed_from_shelf",
    "item_removed": "item_removed_from_shelf",
    "fallen_person": "person_on_ground",
    "person_fallen": "person_on_ground",
    "person_lying_on_floor": "person_on_ground",
    "crowd": "overcrowding",
    "crowded_area": "overcrowding",
    "no_hard_hat": "missing_ppe",
    "worker_without_hard_hat": "missing_ppe",
    "wet_floor": "spill",
    "liquid_on_floor": "spill",
}


def slugify_event_type(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(value or "event").strip().lower())
    return slug.strip("_") or "event"


def canonical_event_type(value: str) -> str:
    slug = slugify_event_type(value)
    return _ALIASES.get(slug, slug)


def normalize_event(event: dict) -> dict:
    normalized = copy.deepcopy(event)
    raw = slugify_event_type(normalized.get("event_type", "event"))
    canonical = canonical_event_type(raw)
    normalized["event_type"] = canonical
    if canonical != raw:
        payload = normalized.setdefault("payload", {})
        payload.setdefault("raw_event_type", raw)
    return normalized


def is_supported_finding(event_type: str, grounded: bool | None) -> bool:
    """High-risk fall alerts require independent visual corroboration."""
    return canonical_event_type(event_type) != "person_on_ground" or grounded is True
