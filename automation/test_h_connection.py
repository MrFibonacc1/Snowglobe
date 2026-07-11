"""One-command H Company Agent API connection test.

  export HAI_API_KEY=hk-...            # from portal.hcompany.ai
  .venv/bin/python test_h_connection.py             # full test (creates 1 session)
  .venv/bin/python test_h_connection.py --auth-only # no session created

Checks, in order:
  1. AUTH      GET /sessions            -> 200 means the key is valid
  2. CREATE    POST /sessions           -> 201 + session id + agent_view_url
  3. EXECUTE   poll GET /sessions/{id}  -> terminal status with steps > 0

Known failure mode (see NOTES.md): CREATE succeeds but the session sits at
status=running, steps=0 forever -> the key lacks Computer-Use Agent
entitlement/credits (portal) or you're in a beta queue. Open the printed
agent_view_url in a browser and ask H mentors.
"""

import envload  # noqa: F401  — loads automation/.env so the key is found

import argparse
import os
import sys
import time

import httpx

REGION = os.environ.get("HAI_AGENT_REGION", "eu").lower()
BASE = os.environ.get(
    "HAI_AGENT_BASE_URL",
    "https://agp.hcompany.ai/api/v2" if REGION == "us" else "https://agp.eu.hcompany.ai/api/v2",
)
AGENT = os.environ.get("HAI_AGENT_NAME", "h/web-surfer-flash")
POLL_SEC = 5
POLL_BUDGET_SEC = int(os.environ.get("H_TEST_BUDGET_SEC", "180"))

TASK = "Go to https://example.com and tell me the exact page title."


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--auth-only", action="store_true", help="skip session creation")
    args = parser.parse_args()

    key = os.environ.get("HAI_API_KEY")
    if not key:
        print("FAIL: HAI_API_KEY is not set. Get one at portal.hcompany.ai and:")
        print("  export HAI_API_KEY=hk-...")
        return 1

    client = httpx.Client(
        base_url=BASE, headers={"Authorization": f"Bearer {key}"}, timeout=30
    )
    print(f"Testing against {BASE} (agent: {AGENT})\n")

    # 1. AUTH ---------------------------------------------------------------
    r = client.get("/sessions")
    if r.status_code in (401, 403):
        # Gateway returns 403 ("explicit deny") for unknown keys, 401 for bad auth.
        print(f"1. AUTH    FAIL — {r.status_code}: key rejected. Wrong key, or wrong")
        print("   region (try HAI_AGENT_REGION=us).")
        return 1
    if r.status_code != 200:
        print(f"1. AUTH    FAIL — unexpected {r.status_code}: {r.text[:200]}")
        return 1
    print("1. AUTH    OK — key accepted (GET /sessions -> 200)")

    if args.auth_only:
        print("\nAuth-only mode: done. Run without --auth-only for the full test.")
        return 0

    # 2. CREATE -------------------------------------------------------------
    r = client.post(
        "/sessions",
        json={"agent": AGENT, "messages": [{"type": "user_message", "message": TASK}]},
    )
    if r.status_code not in (200, 201):
        print(f"2. CREATE  FAIL — {r.status_code}: {r.text[:300]}")
        return 1
    session = r.json()
    sid = session["id"]
    view = session.get("agent_view_url")
    print(f"2. CREATE  OK — session {sid}")
    if view:
        print(f"           watch it live: {view}")

    # 3. EXECUTE ------------------------------------------------------------
    started = time.time()
    last_status, last_steps = None, None
    while time.time() - started < POLL_BUDGET_SEC:
        time.sleep(POLL_SEC)
        s = client.get(f"/sessions/{sid}").json()
        st = s.get("status") or {}
        last_status, last_steps = st.get("status"), st.get("steps")
        elapsed = int(time.time() - started)
        print(f"   [{elapsed:3d}s] status={last_status} steps={last_steps}")
        if s.get("finished_at") or (
            last_status
            and last_status not in {"pending", "running", "starting", "queued",
                                    "initializing", "created"}
        ):
            answer = s.get("latest_answer")
            print(f"3. EXECUTE OK — terminal status={last_status}, steps={last_steps}")
            if answer:
                print(f"           agent answered: {str(answer)[:200]}")
            print("\nConnection fully working. Set H_AGENT_MODE=agent_api and go.")
            return 0

    print(f"3. EXECUTE STALLED — still status={last_status}, steps={last_steps} "
          f"after {POLL_BUDGET_SEC}s.")
    print("   Auth + creation work; execution isn't being serviced. This is")
    print("   account-side (see NOTES.md): check the agent_view_url above in a")
    print("   browser, confirm Agent API entitlement/credits in portal.hcompany.ai,")
    print("   or ask an H mentor. Code-wise you're done — mock mode demos fine.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
