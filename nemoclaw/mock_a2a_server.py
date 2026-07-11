"""Mock of HoloDesktop's `holo serve` A2A endpoint — lets us verify the whole
Snowglobe → NemoClaw plumbing on any laptop, no GPU needed.

Run (uses the automation venv):
  ../automation/.venv/bin/uvicorn mock_a2a_server:app --port 8123

Behavior: message/send returns a Task in state=working; ~4s later tasks/get
returns state=completed with a text artifact echoing the task. Same JSON-RPC
shapes as A2A, so the real `holo serve` is a drop-in URL swap.
"""

import time
import uuid

from fastapi import FastAPI, Request

app = FastAPI(title="mock holo serve (A2A)")

_TASKS: dict[str, dict] = {}
_WORK_SECONDS = 4


@app.post("/")
async def rpc(request: Request):
    body = await request.json()
    method = body.get("method")
    params = body.get("params", {})
    rpc_id = body.get("id")

    if method == "message/send":
        parts = (params.get("message") or {}).get("parts") or []
        text = " ".join(p.get("text", "") for p in parts if p.get("kind") == "text")
        task_id = uuid.uuid4().hex
        _TASKS[task_id] = {"created": time.time(), "text": text}
        return _reply(rpc_id, {
            "kind": "task",
            "id": task_id,
            "status": {"state": "working"},
        })

    if method == "tasks/get":
        task_id = params.get("id")
        task = _TASKS.get(task_id)
        if not task:
            return {"jsonrpc": "2.0", "id": rpc_id,
                    "error": {"code": -32001, "message": "task not found"}}
        if time.time() - task["created"] < _WORK_SECONDS:
            return _reply(rpc_id, {
                "kind": "task", "id": task_id, "status": {"state": "working"},
            })
        return _reply(rpc_id, {
            "kind": "task",
            "id": task_id,
            "status": {"state": "completed"},
            "artifacts": [{
                "artifactId": uuid.uuid4().hex,
                "parts": [{
                    "kind": "text",
                    "text": f"[mock nemoclaw/holo] Executed on 'NVIDIA GPU': "
                            f"{task['text'][:160]}",
                }],
            }],
        })

    return {"jsonrpc": "2.0", "id": rpc_id,
            "error": {"code": -32601, "message": f"method not found: {method}"}}


def _reply(rpc_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": rpc_id, "result": result}
