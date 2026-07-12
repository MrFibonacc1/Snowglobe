"""Post a schema-valid event so automation and the dashboard can develop
without perception.

Event types are open-ended (any snake_case slug the perception model might
surface), so `event_type` here is free-form:

  python send_event.py spill --zone zone_b
  python send_event.py person_count --zone zone_a --count 25
  python send_event.py blocked_exit --zone zone_c --detail "Pallet in front of exit"
"""

import argparse
import re
import uuid
from datetime import datetime, timezone

import httpx

# Convenience defaults for a few common types; anything else works too.
DETAILS = {
    "spill": "Liquid pooled near loading bay",
    "safety_violation": "Worker without hard hat",
    "blocked_exit": "Emergency exit obstructed",
    "missing_ppe": "Worker without required PPE",
}
COUNT_LIKE = re.compile(r"count|traffic|crowd|queue|occupancy")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("event_type", help="any snake_case event type slug, e.g. spill, blocked_exit")
    p.add_argument("--zone", default="zone_a")
    p.add_argument("--count", type=int, default=25)
    p.add_argument("--detail", default=None, help="override the payload detail string")
    p.add_argument("--confidence", type=float, default=0.9)
    p.add_argument("--url", default="http://localhost:8000")
    args = p.parse_args()

    payload: dict = {}
    if COUNT_LIKE.search(args.event_type):
        payload["count"] = args.count
    else:
        payload["detail"] = args.detail or DETAILS.get(
            args.event_type, args.event_type.replace("_", " ").capitalize() + " detected"
        )

    event = {
        "event_id": f"evt_{uuid.uuid4().hex[:10]}",
        "event_type": args.event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "confidence": args.confidence,
        "location": args.zone,
        "payload": payload,
    }
    r = httpx.post(f"{args.url}/events", json=event, timeout=10)
    print(r.status_code, r.json())


if __name__ == "__main__":
    main()
