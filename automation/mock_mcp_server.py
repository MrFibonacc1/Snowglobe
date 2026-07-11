"""Mock MCP server (streamable HTTP) — verify the generic `mcp` step locally
before pointing it at a real server (Google Workspace MCP, Composio MCP, …).

Run:  .venv/bin/uvicorn mock_mcp_server:app --port 8200
Then a workflow step like:
  { "type": "mcp", "config": { "server_url": "http://localhost:8200/mcp",
      "tool": "sheets_append_row",
      "arguments": { "spreadsheet": "demo", "values": ["{{event.location}}"] } } }
"""

import uuid

from fastapi import FastAPI, Request, Response

app = FastAPI(title="mock mcp server")


@app.post("/mcp")
async def mcp(request: Request, response: Response):
    body = await request.json()
    method = body.get("method")
    rpc_id = body.get("id")

    if method == "initialize":
        response.headers["Mcp-Session-Id"] = uuid.uuid4().hex
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "mock-mcp", "version": "0.1"},
            },
        }

    if method == "notifications/initialized":
        response.status_code = 202
        return None

    if method == "tools/call":
        params = body.get("params", {})
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "content": [{
                    "type": "text",
                    "text": f"[mock mcp] tool '{params.get('name')}' called "
                            f"with arguments: {params.get('arguments')}",
                }],
                "isError": False,
            },
        }

    return {"jsonrpc": "2.0", "id": rpc_id,
            "error": {"code": -32601, "message": f"unknown method {method}"}}
