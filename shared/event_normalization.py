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


def is_supported_finding(
    event_type: str,
    grounded: bool | None,
    motion_score: float | None = None,
    objects: list[dict] | None = None,
    detail: str | None = None,
) -> bool:
    """Fail closed for findings a single still image cannot establish.

    Falls require independent object grounding. Object interactions require
    both grounding and meaningful change from the preceding frame; a person
    merely sitting near an object is not evidence of picking it up.
    """
    canonical = canonical_event_type(event_type)
    if canonical == "person_on_ground":
        # A person box does not establish lying/falling pose.
        return False
    if canonical in {"unattended_bag", "unattended_item"}:
        return grounded is True
    detail_slug = slugify_event_type(detail or "")
    temporal_detail = bool(re.search(
        r"(?:pick|hold|held|carry|carried|place|put|remove|take|took|eat|ate|interact|touch)",
        detail_slug,
    ))
    interaction = temporal_detail or (
        (canonical.startswith("item_") and canonical != "unattended_item")
        or any(
        token in canonical
        for token in (
            "item_held", "item_holding", "item_placement", "item_placed",
            "item_interaction", "object_interaction", "shelf_interaction",
            "person_interacting",
        ))
    )
    if interaction:
        if canonical == "item_removed_from_shelf" and not re.search(
            r"(?:pick|tak|took|remov|grab)", detail_slug,
        ):
            # Possession in one frame ("holding/carrying a bag") does not prove
            # the person just took merchandise from a shelf.
            return False
        # Require three independent signals: the VLM described an interaction,
        # adjacent analyzed frames changed materially, and YOLO localized a
        # concrete supporting object. For small shelf products YOLO's COCO model
        # often only resolves the person, so person grounding is valid here;
        # the motion requirement prevents an idle person from firing.
        grounded_objects = objects or []
        needs_item_box = any(
            token in canonical
            for token in ("consum", "conceal", "placed_in_bag", "placement")
        )
        has_yolo_box = bool(grounded_objects) and (
            not needs_item_box
            or any(
                str(obj.get("phrase", "")).strip().lower()
                not in {"", "person", "people"}
                for obj in grounded_objects
            )
        )
        return grounded is True and (motion_score or 0.0) >= 0.03 and has_yolo_box
    # Open-ended VLM findings are hypotheses. Only independently localized
    # static findings may become events; ungrounded prose never fires actions.
    return grounded is True
