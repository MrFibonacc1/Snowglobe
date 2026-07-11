"""Generic MCP step — call any tool on any MCP server (streamable HTTP).

This is the flexible integration lane: Google Workspace, Sheets, Slack,
Notion, GitHub… anything that speaks MCP. One step type, no per-vendor code.

config: {
  "server_url": "https://…/mcp",   # optional if MCP_SERVER_URL env is set
  "tool": "sheets_append_row",      # tool name on that server
  "arguments": { … }                # tool args; {{event.*}} templating applies
}

Auth: bearer token via MCP_SERVER_TOKEN env (or per-step config "token").
Servers with their own OAuth (e.g. hosted Google MCPs) handle it server-side
after a one-time link.
"""

import json
import os
import uuid

import httpx

DEFAULT_SERVER_URL = os.environ.get("MCP_SERVER_URL", "")
DEFAULT_TOKEN = os.environ.get("MCP_SERVER_TOKEN", "")
PROTOCOL_VERSION = "2025-03-26"


def execute(config: dict, event: dict) -> dict:
    server_url = config.get("server_url") or DEFAULT_SERVER_URL
    if not server_url:
        raise RuntimeError("mcp step needs config.server_url or MCP_SERVER_URL env")
    tool = config.get("tool")
    if not tool:
        raise RuntimeError("mcp step needs config.tool")
    arguments = config.get("arguments") or {}

    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    token = config.get("token") or DEFAULT_TOKEN
    if token:
        headers["Authorization"] = f"Bearer {token}"

    with httpx.Client(timeout=60, headers=headers) as client:
        # 1. initialize — server may hand back a session id header
        init = _rpc(client, server_url, "initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "snowglobe-automation", "version": "0.1"},
        })
        session_id = init["headers"].get("mcp-session-id")
        if session_id:
            client.headers["Mcp-Session-Id"] = session_id

        # 2. initialized notification (fire and forget; some servers 202/404 it)
        try:
            client.post(server_url, json={
                "jsonrpc": "2.0", "method": "notifications/initialized",
            })
        except httpx.HTTPError:
            pass

        # 3. the actual tool call
        call = _rpc(client, server_url, "tools/call", {
            "name": tool,
            "arguments": arguments,
        })
        result = call["body"].get("result", {})

    texts = [
        c.get("text", "")
        for c in result.get("content", [])
        if c.get("type") == "text"
    ]
    output = {
        "server_url": server_url,
        "tool": tool,
        "is_error": bool(result.get("isError")),
        "result": "\n".join(texts) or json.dumps(result)[:500],
    }
    if output["is_error"]:
        raise RuntimeError(f"mcp tool {tool} errored: {output['result'][:300]}")
    return output


def _rpc(client: httpx.Client, url: str, method: str, params: dict) -> dict:
    resp = client.post(url, json={
        "jsonrpc": "2.0",
        "id": uuid.uuid4().hex,
        "method": method,
        "params": params,
    })
    resp.raise_for_status()
    body = _parse_body(resp)
    if "error" in body:
        raise RuntimeError(f"mcp {method} error: {body['error']}")
    return {"body": body, "headers": {k.lower(): v for k, v in resp.headers.items()}}


def _parse_body(resp: httpx.Response) -> dict:
    """Servers answer plain JSON or an SSE stream — accept both."""
    ctype = resp.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:].strip())
        raise RuntimeError("empty SSE response from MCP server")
    return resp.json()
