"""Snowglobe automation service.

Run from this directory:  uvicorn main:app --port 8000 --reload
API contract: PLAN.md §Data contracts.
"""

import envload  # noqa: F401  — must be first: loads .env before steps read env

import asyncio
import json
import os
import uuid

import jsonschema
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import engine
import seeds
import storage

_SHARED = os.path.join(os.path.dirname(__file__), "..", "shared")
with open(os.path.join(_SHARED, "event_schema.json")) as f:
    EVENT_SCHEMA = json.load(f)
with open(os.path.join(_SHARED, "workflow_schema.json")) as f:
    WORKFLOW_SCHEMA = json.load(f)

app = FastAPI(title="snowglobe automation")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hackathon: dashboard on :5173
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    storage.init()
    if not storage.list_workflows():
        for wf in seeds.WORKFLOWS:
            storage.upsert_workflow(wf)


def _validate(body: dict, schema: dict) -> None:
    try:
        jsonschema.validate(body, schema)
    except jsonschema.ValidationError as exc:
        raise HTTPException(422, detail=exc.message) from exc


# --- events -----------------------------------------------------------------

@app.post("/events", status_code=202)
async def post_event(event: dict):
    _validate(event, EVENT_SCHEMA)
    storage.insert_event(event)
    run_ids = await engine.handle_event(event)
    return {"accepted": True, "runs_started": run_ids}


@app.get("/events")
async def get_events(limit: int = 50):
    return storage.list_events(limit)


# --- workflows ----------------------------------------------------------------

@app.get("/workflows")
async def get_workflows():
    return storage.list_workflows()


@app.post("/workflows", status_code=201)
async def create_workflow(wf: dict):
    wf.setdefault("id", f"wf_{uuid.uuid4().hex[:8]}")
    _validate(wf, WORKFLOW_SCHEMA)
    storage.upsert_workflow(wf)
    return wf


@app.put("/workflows/{wf_id}")
async def update_workflow(wf_id: str, wf: dict):
    if not storage.get_workflow(wf_id):
        raise HTTPException(404)
    wf["id"] = wf_id
    _validate(wf, WORKFLOW_SCHEMA)
    storage.upsert_workflow(wf)
    return wf


@app.delete("/workflows/{wf_id}", status_code=204)
async def delete_workflow(wf_id: str):
    if not storage.delete_workflow(wf_id):
        raise HTTPException(404)


@app.post("/workflows/{wf_id}/test", status_code=202)
async def test_workflow(wf_id: str):
    """Fire a synthetic matching event at one workflow — ignores enabled
    flag and cooldown. For demos and for the builder's 'Test' button."""
    wf = storage.get_workflow(wf_id)
    if not wf:
        raise HTTPException(404)
    t = wf["trigger"]
    event = {
        "event_id": f"evt_test_{uuid.uuid4().hex[:8]}",
        "event_type": t["event_type"],
        "timestamp": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
        "confidence": 0.99,
        "location": t.get("zone", "zone_test"),
        "payload": {"detail": "synthetic test event", "count": 99},
    }
    storage.insert_event(event)
    run = engine._new_run(wf, event)
    storage.insert_run(run)
    asyncio.create_task(engine.execute_run(run, wf, event))
    return {"accepted": True, "run_id": run["id"]}


# --- runs -----------------------------------------------------------------

@app.get("/runs")
async def get_runs(limit: int = 50):
    return storage.list_runs(limit)


@app.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = storage.get_run(run_id)
    if not run:
        raise HTTPException(404)
    return run


@app.get("/health")
async def health():
    return {"ok": True}
