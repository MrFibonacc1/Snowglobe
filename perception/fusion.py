"""Fuse Grounding DINO object detections into VLM findings.

The VLM discovery pass yields free-form findings (event_type + a human detail
sentence). Grounding DINO can confirm or deny them by actually localizing the
objects involved. This module owns the two halves of that bridge:

1. `phrases_for()` — turn a finding into the object phrases DINO should look for.
   It has no fixed taxonomy: it maps a handful of known event slugs to strong
   phrases, and otherwise derives phrases from the slug and detail text, so an
   event type the model invents on the fly still gets grounded sensibly.

2. `fuse()` — given a finding's expected phrases and DINO's detections, adjust
   the verdict's confidence (boost on confirmation, cut on contradiction) and
   attach the grounded objects/boxes as extra context on the payload.
"""
from __future__ import annotations

import re

from .grounding import Detection, GroundingDetector, GroundingUnavailable
from .vlm import Verdict

# Known event slugs → the concrete objects that, if localized, corroborate them.
# This is a hint map, not a constraint: unknown slugs fall through to the
# derived-phrase path below, so the open-ended event vocabulary still works.
_PHRASE_HINTS: dict[str, list[str]] = {
    "spill": ["spill", "wet floor", "liquid on floor", "puddle"],
    "slip_hazard": ["wet floor", "spill", "puddle"],
    "person_on_ground": ["person lying on floor", "fallen person", "person on ground"],
    "fall": ["person lying on floor", "fallen person"],
    "fight": ["people fighting", "person"],
    "aggression": ["people fighting", "person"],
    "weapon": ["gun", "knife", "weapon"],
    "fire": ["fire", "flames", "smoke"],
    "smoke": ["smoke", "fire"],
    "unattended_item": ["unattended bag", "backpack", "suitcase", "box"],
    "unattended_bag": ["unattended bag", "backpack", "suitcase"],
    "blocked_exit": ["blocked door", "boxes", "obstruction", "exit door"],
    "long_queue": ["queue of people", "line of people", "person"],
    "overcrowding": ["crowd of people", "person"],
    "person_count": ["person"],
    "foot_traffic": ["person"],
    "forklift_near_pedestrian": ["forklift", "person"],
    "vehicle_near_person": ["vehicle", "forklift", "person"],
    "missing_ppe": ["person without hard hat", "person", "hard hat"],
    "intrusion": ["person", "intruder"],
    # Retail object-interaction slugs the discovery prompt now emits. Ground them
    # on the person plus the common merchandise classes YOLO knows.
    "item_pickup": ["person", "bottle", "cup", "handbag", "backpack", "book"],
    "item_placed_in_bag": ["person", "backpack", "handbag", "suitcase", "bottle"],
    "shelf_interaction": ["person", "bottle", "cup", "book"],
    "object_interaction": ["person", "bottle", "cup", "handbag", "backpack"],
    "item_removed_from_shelf": ["person", "bottle", "cup", "book"],
    "item_concealed": ["person", "backpack", "handbag"],
}

# Objects worth pulling out of a free-form detail sentence when we have no hint.
_KNOWN_OBJECTS = [
    "person", "people", "forklift", "vehicle", "car", "truck", "bag", "backpack",
    "box", "boxes", "spill", "puddle", "fire", "smoke", "weapon", "gun", "knife",
    "cart", "pallet", "ladder", "door", "hard hat", "helmet",
]


def phrases_for(verdict: Verdict, max_phrases: int = 5) -> list[str]:
    """Object phrases Grounding DINO should search for to corroborate a finding."""
    slug = verdict.event_type
    phrases: list[str] = list(_PHRASE_HINTS.get(slug, []))

    # Derive from the slug itself (e.g. "blocked_fire_exit" → "blocked fire exit").
    words = slug.replace("_", " ").strip()
    if words and words not in phrases:
        phrases.append(words)

    # Pull concrete nouns out of the detail sentence the VLM wrote.
    if verdict.detail:
        low = verdict.detail.lower()
        for obj in _KNOWN_OBJECTS:
            if re.search(rf"\b{re.escape(obj)}\b", low) and obj not in phrases:
                phrases.append(obj)

    # De-dupe, keep order, cap length (the endpoint caps prompt length too).
    seen: list[str] = []
    for p in phrases:
        if p and p not in seen:
            seen.append(p)
    return seen[:max_phrases]


def fuse(verdict: Verdict, phrases: list[str], detections: list[Detection]) -> Verdict:
    """Adjust a verdict using object detections and attach the grounded objects.

    Records the two honest, separable signals on the verdict:
    * `vlm_confidence` — the model's raw self-report (captured before blending).
    * `grounding_confidence` — the detector's best supporting-box score
      (0.0 when we looked and found nothing).

    Then rewrites `confidence` (the gate value):
    * Confirmed (detector localized ≥1 expected object): nudge confidence up
      toward the joint confidence of both models and record what was seen.
    * Denied (we had phrases to look for but the detector found none): cut
      confidence, since there's no physical evidence for the VLM's claim.
    * No phrases / grounding disabled: leave the verdict untouched.
    """
    if not phrases:
        return verdict

    # Capture the VLM's own confidence before we blend in the detector — this is
    # what makes the final number honest downstream (VLM said X, grounding did Y).
    if verdict.vlm_confidence is None:
        verdict.vlm_confidence = verdict.confidence

    if detections:
        best = max(d.confidence for d in detections)
        verdict.grounding_confidence = best
        # Confirmation should raise confidence but not to a blind 1.0; blend the
        # VLM's confidence with the detector's, biased toward the higher one.
        verdict.confidence = round(
            min(1.0, max(verdict.confidence, 0.5 * verdict.confidence + 0.5 * best) + 0.1),
            3,
        )
        objects = [
            {"phrase": d.phrase, "confidence": round(d.confidence, 3), "boxes": d.boxes}
            for d in detections
        ]
        verdict.grounded = True
        verdict.objects = objects
    else:
        # We looked and found nothing — treat as weak contradiction.
        verdict.grounding_confidence = 0.0
        verdict.confidence = round(verdict.confidence * 0.6, 3)
        verdict.grounded = False
        verdict.objects = []
    return verdict


def ground_verdicts(
    grounder, frame_bgr, verdicts: list[Verdict]
) -> list[Verdict]:
    """Confirm/deny each discovery verdict with the object detector, in place.

    Works with either backend:
      * YoloDetector (local, current) — detects once per finding by phrase; never
        raises, so a "no boxes" result is a genuine contradiction (grounded=False).
      * GroundingDetector (NVIDIA DINO, deprecated) — may raise GroundingUnavailable
        if the endpoint is down/unprovisioned; in that case we stop and leave the
        remaining findings untouched (grounded stays None) so an unavailable
        detector never penalizes a finding.
    """
    if not getattr(grounder, "enabled", False) or not verdicts:
        return verdicts
    # Optimization for local YOLO: it detects the whole frame anyway, so run it
    # once and match per-finding, instead of one model call per finding.
    frame_dets = None
    if hasattr(grounder, "detect_all"):
        try:
            frame_dets = grounder.detect_all(frame_bgr)
        except Exception:
            frame_dets = []
    for v in verdicts:
        phrases = phrases_for(v)
        if not phrases:
            continue
        if frame_dets is not None:
            detections = _match_local(frame_dets, phrases)
        else:
            try:
                detections = grounder.detect(frame_bgr, phrases)
            except GroundingUnavailable:
                break
        fuse(v, phrases, detections)
    return verdicts


def _match_local(frame_dets, phrases: list[str]):
    """Filter a whole-frame detection list down to the phrases a finding wants,
    using the same class/alias matching the YOLO backend uses."""
    from .objects import _CLASS_ALIASES, _matches

    wanted = [p.strip().lower() for p in phrases if p.strip()]
    out = []
    for det in frame_dets:
        cls = det.phrase.lower()
        aliases = _CLASS_ALIASES.get(cls, [cls])
        if _matches(cls, aliases, wanted):
            out.append(det)
    return out
