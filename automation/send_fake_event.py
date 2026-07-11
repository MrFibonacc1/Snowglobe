"""Post a schema-valid fake event — lets automation + dashboard develop
without perception.

  python send_fake_event.py spill --zone zone_b
  python send_fake_event.py person_count --zone zone_a --count 25
"""

import argparse
import uuid
from datetime import datetime, timezone

import httpx

DETAILS = {
    "spill": "Liquid pooled near loading bay",
    "safety_violation": "Worker without hard hat",
}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("event_type", choices=["spill", "person_count", "foot_traffic", "safety_violation"])
    p.add_argument("--zone", default="zone_a")
    p.add_argument("--count", type=int, default=25)
    p.add_argument("--confidence", type=float, default=0.9)
    p.add_argument("--url", default="http://localhost:8000")
    args = p.parse_args()

    payload: dict = {}
    if args.event_type in ("person_count", "foot_traffic"):
        payload["count"] = args.count
    else:
        payload["detail"] = DETAILS[args.event_type]

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
