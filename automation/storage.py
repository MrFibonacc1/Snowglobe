"""SQLite persistence for events, workflows, runs.

Rows store the full JSON body as TEXT — schema evolution is free and we
never fight the ORM at a hackathon. One connection per operation keeps it
thread/async safe enough for our traffic.
"""

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from collections.abc import Iterator

DB_PATH = os.environ.get(
    "AUTOMATION_DB", os.path.join(os.path.dirname(__file__), "data.db")
)


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init() -> None:
    with _conn() as c:
        c.execute("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, body TEXT, created REAL)")
        c.execute("CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, body TEXT)")
        c.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT, created REAL)")
        c.execute("""CREATE TABLE IF NOT EXISTS inventory_items (
            sku TEXT PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL,
            location TEXT, updated REAL NOT NULL
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS inventory_adjustments (
            event_id TEXT NOT NULL, sku TEXT NOT NULL, delta INTEGER NOT NULL,
            before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
            created REAL NOT NULL, PRIMARY KEY (event_id, sku)
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS cooldown_claims (
            workflow_id TEXT NOT NULL, location TEXT NOT NULL,
            claimed_at REAL NOT NULL, PRIMARY KEY (workflow_id, location)
        )""")


# --- events ---------------------------------------------------------------

def insert_event(event: dict) -> None:
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO events VALUES (?, ?, ?)",
            (event["event_id"], json.dumps(event), time.time()),
        )


def list_events(limit: int = 50) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT body FROM events ORDER BY created DESC LIMIT ?", (limit,)
        ).fetchall()
    return [json.loads(r["body"]) for r in rows]


# --- workflows ------------------------------------------------------------

def upsert_workflow(wf: dict) -> None:
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO workflows VALUES (?, ?)", (wf["id"], json.dumps(wf)))


def list_workflows() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT body FROM workflows").fetchall()
    return [json.loads(r["body"]) for r in rows]


def get_workflow(wf_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT body FROM workflows WHERE id = ?", (wf_id,)).fetchone()
    return json.loads(row["body"]) if row else None


def delete_workflow(wf_id: str) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM workflows WHERE id = ?", (wf_id,))
    return cur.rowcount > 0


# --- runs -----------------------------------------------------------------

def insert_run(run: dict) -> None:
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO runs VALUES (?, ?, ?)",
            (run["id"], json.dumps(run), time.time()),
        )


def update_run(run: dict) -> None:
    with _conn() as c:
        c.execute("UPDATE runs SET body = ? WHERE id = ?", (json.dumps(run), run["id"]))


def list_runs(limit: int = 50) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT body FROM runs ORDER BY created DESC LIMIT ?", (limit,)
        ).fetchall()
    return [json.loads(r["body"]) for r in rows]


def get_run(run_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT body FROM runs WHERE id = ?", (run_id,)).fetchone()
    return json.loads(row["body"]) if row else None


# --- inventory -------------------------------------------------------------

def upsert_inventory(item: dict) -> None:
    quantity = int(item["quantity"])
    if quantity < 0:
        raise ValueError("inventory quantity cannot be below zero")
    with _conn() as c:
        c.execute(
            """INSERT INTO inventory_items (sku, name, quantity, location, updated)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(sku) DO UPDATE SET name=excluded.name,
                 quantity=excluded.quantity, location=excluded.location, updated=excluded.updated""",
            (item["sku"], item.get("name") or item["sku"], quantity,
             item.get("location"), time.time()),
        )


def list_inventory() -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT sku, name, quantity, location, updated FROM inventory_items ORDER BY sku"
        ).fetchall()
    return [dict(row) for row in rows]


def adjust_inventory(sku: str, delta: int, event_id: str) -> dict:
    delta = int(delta)
    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        prior = c.execute(
            """SELECT delta, before_quantity, after_quantity
               FROM inventory_adjustments WHERE event_id = ? AND sku = ?""",
            (event_id, sku),
        ).fetchone()
        if prior:
            return {
                "sku": sku, "delta": prior["delta"],
                "before": prior["before_quantity"], "after": prior["after_quantity"],
                "applied": False, "event_id": event_id,
            }
        item = c.execute(
            "SELECT quantity FROM inventory_items WHERE sku = ?", (sku,)
        ).fetchone()
        if not item:
            raise ValueError(f"unknown SKU: {sku}")
        before = int(item["quantity"])
        after = before + delta
        if after < 0:
            raise ValueError(f"inventory adjustment would take {sku} below zero")
        now = time.time()
        c.execute(
            "UPDATE inventory_items SET quantity = ?, updated = ? WHERE sku = ?",
            (after, now, sku),
        )
        c.execute(
            """INSERT INTO inventory_adjustments
               (event_id, sku, delta, before_quantity, after_quantity, created)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (event_id, sku, delta, before, after, now),
        )
        return {
            "sku": sku, "delta": delta, "before": before, "after": after,
            "applied": True, "event_id": event_id,
        }


# --- cooldowns -------------------------------------------------------------

def claim_cooldown(
    workflow_id: str, location: str, window_sec: float, now: float | None = None
) -> bool:
    if window_sec <= 0:
        return True
    claimed_at = time.time() if now is None else float(now)
    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute(
            "SELECT claimed_at FROM cooldown_claims WHERE workflow_id = ? AND location = ?",
            (workflow_id, location),
        ).fetchone()
        if row and claimed_at - float(row["claimed_at"]) < window_sec:
            return False
        c.execute(
            """INSERT INTO cooldown_claims (workflow_id, location, claimed_at)
               VALUES (?, ?, ?) ON CONFLICT(workflow_id, location)
               DO UPDATE SET claimed_at=excluded.claimed_at""",
            (workflow_id, location, claimed_at),
        )
        return True
