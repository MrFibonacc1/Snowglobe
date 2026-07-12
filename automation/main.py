"""Snowglobe automation service.

Run from this directory:  uvicorn main:app --port 8000 --reload
API contract: PLAN.md §Data contracts.
"""

import envload  # noqa: F401  — must be first: loads .env before steps read env

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

_ROOT = str(Path(__file__).resolve().parents[1])
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Load automation/.env (H_AGENT_MODE, HAI_API_KEY, COMPOSIO_API_KEY, …) before
# importing engine/steps, since some step modules read env at import time.
# Absolute path so it works regardless of the launch directory.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
except Exception:
    pass  # python-dotenv not installed — rely on real env vars

import jsonschema
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

import agent_view
import engine
import composio_status
import generate
import scheduler
import seeds
import storage
from shared.event_normalization import normalize_event

# Where the voice step writes synthesized clips; served below at /audio/{name}
# so the dashboard and downstream steps get a reachable audio_url. Kept in sync
# with steps/voice.py's default via the same VOICE_AUDIO_DIR env var.
_AUDIO_DIR = os.environ.get(
    "VOICE_AUDIO_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio")
)

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
    if not storage.list_inventory():
        storage.upsert_inventory({
            "sku": "front-shelf-item", "name": "Front shelf item",
            "quantity": 24, "location": "front_shelf",
        })
    if not storage.list_workflows():
        for wf in seeds.WORKFLOWS:
            storage.upsert_workflow(wf)
    else:
        # This shipped seed previously called an httpbin pizza form and claimed
        # it was inventory. Replace that known demo workflow with the real,
        # idempotent inventory action while leaving user workflows untouched.
        stock = next((wf for wf in seeds.WORKFLOWS if wf["id"] == "wf_stock_update"), None)
        if stock:
            storage.upsert_workflow(stock)
    # Fire cron/schedule workflows on their cadence.
    asyncio.create_task(scheduler.loop())


def _validate(body: dict, schema: dict) -> None:
    try:
        jsonschema.validate(body, schema)
    except jsonschema.ValidationError as exc:
        raise HTTPException(422, detail=exc.message) from exc


# --- events -----------------------------------------------------------------

@app.post("/events", status_code=202)
async def post_event(event: dict):
    event = normalize_event(event)
    _validate(event, EVENT_SCHEMA)
    storage.insert_event(event)
    run_ids = await engine.handle_event(event)
    return {"accepted": True, "runs_started": run_ids}


@app.get("/events")
async def get_events(limit: int = 50):
    return storage.list_events(limit)


@app.get("/inventory")
async def get_inventory():
    return storage.list_inventory()


@app.put("/inventory/{sku}")
async def put_inventory(sku: str, item: dict):
    record = {**item, "sku": sku}
    if "quantity" not in record:
        raise HTTPException(422, detail="quantity required")
    try:
        storage.upsert_inventory(record)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    return next(value for value in storage.list_inventory() if value["sku"] == sku)


# --- workflows ----------------------------------------------------------------

@app.post("/generate_workflow")
async def generate_workflow(body: dict):
    """Natural language → a draft workflow (not saved). The dashboard chat
    shows it for review; the user saves via POST /workflows."""
    description = (body or {}).get("description", "")
    if not description.strip():
        raise HTTPException(422, detail="description required")
    wf = await asyncio.to_thread(generate.generate_workflow, description)
    # Best-effort validate; return regardless so the builder can fix edge cases.
    try:
        jsonschema.validate(wf, WORKFLOW_SCHEMA)
        wf["_valid"] = True
    except jsonschema.ValidationError as exc:
        wf["_valid"] = False
        wf["_validation_error"] = exc.message
    return wf


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
    # Schedule workflows: fire a real aggregate run now (over the lookback window).
    if scheduler.is_schedule(wf):
        run_id = await scheduler.run_scheduled(wf)
        return {"accepted": True, "run_id": run_id}
    t = wf["trigger"]
    event = {
        "event_id": f"evt_test_{uuid.uuid4().hex[:8]}",
        "event_type": t.get("event_type", "*"),
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


# --- live agent view (H session movement stream, proxied for the browser) ---

@app.get("/agent/sessions/{session_id}/events")
async def get_agent_session_feed(session_id: str):
    """The agent's live movements for one H session: latest screenshot (proxied),
    cursor position, and an ordered action log. Powers the Overview's
    'watch the agent work' box. See agent_view.py."""
    try:
        return await asyncio.to_thread(agent_view.fetch_session_feed, session_id)
    except agent_view.AgentViewUnavailable as exc:
        raise HTTPException(404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — upstream/network hiccup
        raise HTTPException(502, detail=f"agent event fetch failed: {exc}") from exc


@app.get("/agent/screenshot")
async def get_agent_screenshot(url: str):
    """Stream an authed H trajectory screenshot to the browser (H image URLs
    require the API key, so the browser can't load them directly)."""
    try:
        content, content_type = await asyncio.to_thread(agent_view.fetch_screenshot, url)
    except agent_view.AgentViewUnavailable as exc:
        raise HTTPException(400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, detail=f"screenshot fetch failed: {exc}") from exc
    # Short cache: screenshots are immutable per URL, but the "latest" pointer
    # changes each step, so a brief cache is safe and cuts re-fetches.
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "max-age=60"})


# --- audio (synthesized voice clips) ----------------------------------------

@app.get("/audio/{name}")
async def get_audio(name: str):
    """Serve a voice-step clip written to VOICE_AUDIO_DIR. Flat filenames only
    (no path traversal); the voice step names them voice_<hex>.<ext>."""
    if "/" in name or "\\" in name or name.startswith("."):
        raise HTTPException(400, detail="bad name")
    path = os.path.join(_AUDIO_DIR, name)
    if not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path)


@app.post("/integrations/composio/{toolkit}/connect")
async def connect_composio(toolkit: str):
    """Start a Composio OAuth link and return the URL the user opens to
    authorize. The dashboard opens it in a new tab, then polls /status until
    the toolkit flips to connected."""
    try:
        return await asyncio.to_thread(composio_status.initiate_connection, toolkit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — surface Composio's reason to the UI
        raise HTTPException(status_code=502, detail=f"Composio could not start the link: {exc}")


@app.get("/status")
async def status(refresh: bool = False):
    """Real integration state for the dashboard — booleans only, never values.
    Pass ?refresh=1 to bypass the 60s Composio cache (used right after a
    connect so the card flips promptly)."""
    return {
        "h_agent": {
            "mode": os.environ.get("H_AGENT_MODE", "mock"),
            "key_present": bool(os.environ.get("HAI_API_KEY")),
            "region": os.environ.get("HAI_AGENT_REGION", "eu"),
        },
        "composio": await asyncio.to_thread(composio_status.get_composio_status, refresh),
        "gradium": {"configured": bool(os.environ.get("GRADIUM_API_KEY"))},
        "nemoclaw": {
            "url": os.environ.get("NEMOCLAW_A2A_URL", "http://localhost:8123"),
            "active": os.environ.get("H_AGENT_MODE") == "nemoclaw",
        },
        "counts": {
            "events": len(storage.list_events(1000)),
            "workflows": len(storage.list_workflows()),
            "runs": len(storage.list_runs(1000)),
        },
    }
