"""Server-side object detection with a local YOLO model (ultralytics).

This is the real, working object-grounding backend. NVIDIA's hosted Grounding
DINO is deprecated (every call 404s "Not found for account"), so we run a small
YOLO model *inside* the perception service instead. It runs wherever this
service is deployed — no laptop, no external CV API, no per-call cost — so the
deployed backend (and the mobile web-app that talks to it) gets real bounding
boxes.

YOLO is closed-vocabulary (80 COCO classes: person, bottle, backpack, handbag,
cup, cell phone, …), which covers most retail/warehouse/facility objects. It
detects everything in the frame once; `fusion.py` then matches those detections
against the phrases a VLM finding cares about. Boxes are returned in normalized
[0..1] coordinates so the frontend can overlay them on any rendered frame size.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field

# COCO class → extra phrase aliases so a VLM finding's phrase ("shopper",
# "merchandise") can still match a concrete YOLO class ("person", "bottle").
# Only the alias side is fuzzy; the class names themselves are always matchable.
_CLASS_ALIASES: dict[str, list[str]] = {
    "person": ["person", "people", "shopper", "customer", "worker", "staff",
               "pedestrian", "individual", "man", "woman", "child"],
    "backpack": ["backpack", "bag", "rucksack"],
    "handbag": ["handbag", "purse", "bag"],
    "suitcase": ["suitcase", "luggage", "bag"],
    "bottle": ["bottle", "drink", "beverage", "merchandise", "item", "product"],
    "cup": ["cup", "coffee", "drink"],
    "cell phone": ["cell phone", "phone", "mobile", "smartphone"],
    "handbag ": ["handbag"],
    "knife": ["knife", "blade", "weapon"],
    "scissors": ["scissors"],
    "wine glass": ["wine glass", "glass"],
    "book": ["book", "product", "item"],
    "laptop": ["laptop", "computer"],
    "tv": ["tv", "monitor", "screen"],
}


@dataclass
class Detection:
    """One detected object. Boxes are normalized [x1, y1, x2, y2] in 0..1."""

    phrase: str
    confidence: float
    boxes: list[list[float]] = field(default_factory=list)


class YoloDetector:
    """Local YOLO object detector. Lazy-loads weights on first use and warms the
    model so the first real request isn't penalized by the cold-start cost.

    `enabled=False` (backend disabled or ultralytics unavailable) makes every
    call a no-op returning [], so callers never need to branch."""

    def __init__(self, config):
        self.cfg = config
        backend = str(getattr(config, "grounding_backend", "yolo")).lower()
        self.weights = getattr(config, "yolo_model", "yolov8s.pt")
        self.conf = float(getattr(config, "yolo_conf", 0.25))
        self._model = None
        self._lock = threading.Lock()
        self._load_error: str | None = None
        self.enabled = backend == "yolo"

    def _ensure_model(self):
        """Import ultralytics + load weights once, under a lock. On failure we
        disable ourselves and remember why (surfaced by /health)."""
        if self._model is not None or not self.enabled:
            return
        with self._lock:
            if self._model is not None:
                return
            try:
                from ultralytics import YOLO  # heavy import; do it lazily

                model = YOLO(self.weights)
                # Warm the graph so the first user request is fast.
                import numpy as np

                model(np.zeros((640, 640, 3), dtype="uint8"), verbose=False)
                self._model = model
            except Exception as e:  # torch/weights/network — degrade gracefully
                self._load_error = str(e)
                self.enabled = False

    @property
    def model_name(self) -> str | None:
        return self.weights if self.enabled else None

    def detect_all(self, frame_bgr) -> list[Detection]:
        """Detect every object in the frame, one Detection per COCO class present
        (boxes for that class merged into one Detection). Normalized coords."""
        self._ensure_model()
        if not self.enabled or self._model is None:
            return []
        h, w = frame_bgr.shape[:2]
        try:
            result = self._model(frame_bgr, verbose=False, conf=self.conf)[0]
        except Exception:
            return []
        by_class: dict[str, Detection] = {}
        names = result.names
        for box in result.boxes:
            cls = names[int(box.cls)]
            conf = float(box.conf)
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            norm = [
                round(x1 / w, 4), round(y1 / h, 4),
                round(x2 / w, 4), round(y2 / h, 4),
            ]
            det = by_class.get(cls)
            if det is None:
                by_class[cls] = Detection(phrase=cls, confidence=conf, boxes=[norm])
            else:
                det.confidence = max(det.confidence, conf)
                det.boxes.append(norm)
        return list(by_class.values())

    def detect(self, frame_bgr, phrases: list[str]) -> list[Detection]:
        """Grounding-compatible entry point: return only the detected objects
        whose class matches one of the requested `phrases` (by alias/substring).

        Matches the old GroundingDetector.detect signature so fusion.py can call
        either backend the same way. Never raises."""
        all_dets = self.detect_all(frame_bgr)
        if not phrases:
            return all_dets
        wanted = [p.strip().lower() for p in phrases if p.strip()]
        out: list[Detection] = []
        for det in all_dets:
            cls = det.phrase.lower()
            aliases = _CLASS_ALIASES.get(cls, [cls])
            if _matches(cls, aliases, wanted):
                out.append(det)
        return out


def _matches(cls: str, aliases: list[str], wanted: list[str]) -> bool:
    """True if any requested phrase overlaps this class or its aliases."""
    for w in wanted:
        for a in aliases:
            if a in w or w in a:
                return True
        if cls in w or w in cls:
            return True
    return False
