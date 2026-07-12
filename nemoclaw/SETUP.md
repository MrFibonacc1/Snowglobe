# NVIDIA Challenge: H models through NemoClaw (official pattern)

Based on H's own demo: [hcompai/computer-use-agents-demos/nemoclaw](https://github.com/hcompai/computer-use-agents-demos/tree/main/nemoclaw).
No GPU needed anywhere: NemoClaw runs in Docker (works on our Macs), the
harness's inference uses a cloud credential (we have `NVIDIA_API_KEY`), and
the H agents run on H's platform reached via their hosted MCP server.

## Verified with our key (2026-07-11 night)

Probed `https://agp.eu.hcompany.ai/mcp` (Bearer `HAI_API_KEY`):
- ✅ initialize → 200, server `hai-agents v2.14.7`
- ✅ 6 tools: `run_agent`, `wait_for_session`, `list_agents`, `send_message`
  (mid-run follow-ups!), `cancel_session`, `share_session` (public replay URL)
- ✅ `list_agents` → **5 agents on our key**: `h/web-surfer-pro`,
  `h/web-surfer-flash`, `h/web-scraper-pro`, `h/web-scraper-flash`,
  `h/deep-search-pro` (research orchestrator with citations)

## Architecture (H's official demo)

```
 NemoClaw (Docker sandbox: OpenShell + k3s, network egress policies)
   └─ Hermes harness agent (inference: NVIDIA cloud / Anthropic / Ollama)
        └─ MCP client → https://agp.eu.hcompany.ai/mcp  (Bearer HAI_API_KEY)
             └─ run_agent → H's hosted computer-use agents (Holo-powered)
```

The sandbox's egress policy is the crux: OpenShell blocks all hosts except
those allowed, so `agp.eu.hcompany.ai` must be explicitly permitted.

## Setup (any Docker machine, our Macs qualify)

Run in a real terminal (step 2's wizard is interactive):

```bash
# 0. prereqs: Docker running; keys at hand:
#    HAI_API_KEY   (automation/.env)
#    NVIDIA_API_KEY (perception/.env), pick "NVIDIA" as inference provider

# 1. install NemoClaw + clone H's demos
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
git clone https://github.com/hcompai/computer-use-agents-demos
cd computer-use-agents-demos

# 2. build the sandbox (custom image adds HTTP-MCP support; ~2.4 GB)
export NEMOCLAW_AGENT=hermes
nemohermes onboard --from nemoclaw/image/Dockerfile --name hai-hermes
#    wizard: inference provider = NVIDIA, paste NVIDIA_API_KEY, pick a model

# 3. allow egress to H's platform (default policy blocks it)
nemohermes hai-hermes policy-add --from-file nemoclaw/policies/hai-agent-platform.yaml
nemohermes hai-hermes policy-list        # confirm agp.eu.hcompany.ai listed

# 4. register H's MCP server inside the sandbox
nemohermes hai-hermes connect
#    edit /sandbox/.hermes/config.yaml, add:
#    mcp_servers:
#      hai-agent-platform:
#        url: https://agp.eu.hcompany.ai/mcp
#        headers: { Authorization: "Bearer hk-...our-key..." }
#        timeout: 420

# 5. validate
hermes mcp test hai-agent-platform       # should expose the 6 tools
#    then in hermes chat: "list the available H agents"
```

Gotchas from H's README:
- Stock sandbox lacks `mcp.client.streamable_http`; that's why step 2 builds
  from their Dockerfile, so don't skip it.
- If a call is denied, `openshell term` names the binary that needs adding to
  the policy (theirs: `/opt/hermes/.venv/bin/python3`).

## Snowglobe pipeline integration (built and verified live)

`H_AGENT_MODE=agent_mcp` (steps/h_agent.py) drives H agents through this
exact MCP surface: `run_agent` → `wait_for_session` long-poll →
`share_session`. Verified 2026-07-11 night with a real event:

- spill event → workflow → run_agent(`h/web-surfer-flash`) → answer in 31s
- public replay URL returned and surfaced as the run's replay link:
  `https://agp.eu.hcompany.ai/share/api/v1/trajectories/<session>`

Per-step config extras: `"agent"` (any of the 5 from list_agents),
`"share": true` (public replay URL), `"timeout_sec"` (long missions).
Tool schemas (verified): `run_agent{task, agent, max_steps, max_time_s}`,
`wait_for_session{session_id, wait}`, `share_session{session_id}`.

So the challenge demo is: **camera event → Snowglobe workflow → run_agent →
H agent**, and the same `run_agent` invoked from inside the NemoClaw sandbox
for the judged artifact. `send_message` enables mid-run follow-ups.

The generic `mcp` step can also call these tools directly
(`MCP_SERVER_TOKEN` = HAI key), but `agent_mcp` handles the poll/share
lifecycle for you, so prefer it for h_agent work.

## Alternatives kept for reference

- **`H_AGENT_MODE=nemoclaw` (A2A → `holo serve`)**: the local-Holo variant
  (HoloDesktop on a machine you control). Still plumbed and mock-tested,
  relevant if we want the "weights on our own NVIDIA GPU" story.
- **Local rehearsal, zero deps**: `../automation/.venv/bin/uvicorn
  mock_a2a_server:app --port 8123` + `H_AGENT_MODE=nemoclaw`.
- **Demo backbone**: `H_AGENT_MODE=agent_api` (H cloud REST), verified and
  untouched by any of this.
