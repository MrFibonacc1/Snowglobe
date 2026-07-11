"""SQLite persistence for events, workflows, runs.

Rows store the full JSON body as TEXT — schema evolution is free and we
never fight the ORM at a hackathon. One connection per operation keeps it
thread/async safe enough for our traffic.
"""

import json
import os
import sqlite3
import time

DB_PATH = os.environ.get(
    "AUTOMATION_DB", os.path.join(os.path.dirname(__file__), "data.db")
)


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _conn() as c:
        c.execute("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, body TEXT, created REAL)")
        c.execute("CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, body TEXT)")
        c.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT, created REAL)")


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
