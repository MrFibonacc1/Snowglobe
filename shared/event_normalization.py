"""Canonical event semantics shared by perception and automation."""

import copy
import re


_ALIASES = {
    "person_holding_item": "item_removed_from_shelf",
    "item_pickup": "item_removed_from_shelf",
    "person_picking_up_item": "item_removed_from_shelf",
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

_RULES = (
    (re.compile(r"(?:pick(?:ed|ing)?_?up|tak(?:e|en|ing)|remov(?:e|ed|ing)).*(?:item|product|shelf|display)"),
     "item_removed_from_shelf"),
    (re.compile(r"(?:item|product).*(?:pick(?:ed|ing)?_?up|tak(?:e|en|ing)|remov(?:e|ed|ing))"),
     "item_removed_from_shelf"),
    (re.compile(r"(?:spill|spilled|spillage|puddle|wet_floor|liquid_(?:on|across)_floor|water_.*floor)"),
     "spill"),
    (re.compile(r"(?:no|missing|without|not_wearing).*(?:ppe|hard_?hat|helmet|safety_?vest)"),
     "missing_ppe"),
    (re.compile(r"(?:overcrowd|crowded|too_many_(?:people|persons)|capacity_exceeded|excessive_occupancy)"),
     "overcrowding"),
    (re.compile(r"(?:fallen_person|person_(?:fallen|lying|down|on).*(?:floor|ground)|person_on_ground)"),
     "person_on_ground"),
)


def slugify_event_type(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(value or "event").strip().lower())
    return slug.strip("_") or "event"


def canonical_event_type(value: str) -> str:
    slug = slugify_event_type(value)
    alias = _ALIASES.get(slug)
    if alias:
        return alias
    for pattern, canonical in _RULES:
        if pattern.search(slug):
            return canonical
    return slug


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
