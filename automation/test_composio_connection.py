"""Composio connection test — mirrors test_h_connection.py.

  .venv/bin/python test_composio_connection.py

Checks, in order:
  1. AUTH        can the key read the management API? (list connected accounts)
  2. TOOLKITS    are the toolkits our workflows use (slack/sheets/drive) linked
                 with an ACTIVE connected account?
  3. EXECUTE     can the key actually run a tool? (no-auth utility tool)

Any of these can pass/fail independently — the script prints exactly which.
"""

import os

import envload  # noqa: F401 — loads automation/.env

NEEDED = {"slack": "SLACK_SEND_MESSAGE",
          "googlesheets": "GOOGLESHEETS_BATCH_UPDATE",
          "googledrive": "GOOGLEDRIVE_UPLOAD_FILE"}
USER_ID = os.environ.get("COMPOSIO_USER_ID", "default")


def main() -> int:
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("FAIL: COMPOSIO_API_KEY not set (add it to automation/.env)")
        return 1

    from composio import Composio
    c = Composio(api_key=key)

    # 1. AUTH ---------------------------------------------------------------
    try:
        accts = list(getattr(c.connected_accounts.list(), "items", []))
        print(f"1. AUTH     OK — key reads the API ({len(accts)} connected accounts)")
    except Exception as e:  # noqa: BLE001
        print(f"1. AUTH     FAIL — {type(e).__name__}: {str(e)[:160]}")
        return 1

    # 2. TOOLKITS -----------------------------------------------------------
    active = {}
    for a in accts:
        tk = getattr(a, "toolkit", None)
        slug = getattr(tk, "slug", None) or getattr(a, "app_name", "?")
        if getattr(a, "status", "") == "ACTIVE":
            active.setdefault(slug, 0)
            active[slug] += 1
    print(f"   active toolkits: {dict(active) or 'none'}")
    for tk in NEEDED:
        state = "LINKED ✓" if active.get(tk) else "NOT CONNECTED — needs OAuth"
        print(f"2. TOOLKIT  {tk:14s} {state}")

    # 3. EXECUTE ------------------------------------------------------------
    try:
        r = c.tools.execute(slug="COMPOSIO_SEARCH_TOOLS", user_id=USER_ID,
                            arguments={"query": "slack"},
                            dangerously_skip_version_check=True)
        d = r if isinstance(r, dict) else r.model_dump()
        if d.get("successful"):
            print("3. EXECUTE  OK — key can run tools")
        else:
            print(f"3. EXECUTE  tool ran but returned error: {str(d.get('error'))[:120]}")
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:160]
        print(f"3. EXECUTE  FAIL — {type(e).__name__}: {msg}")
        if "Invalid API key" in msg or "401" in msg:
            print("   → This key can READ but not EXECUTE. Needs a key with tool-")
            print("     execution rights (or execution enabled on the account).")
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
