# NVIDIA Challenge setup — H models through NemoClaw

Goal: camera events → Snowglobe workflow engine → **H's Holo 3.1 models
executing the UI task locally on an NVIDIA GPU, inside the NemoClaw stack**.

Snowglobe side is DONE (`H_AGENT_MODE=nemoclaw` backend in
`automation/steps/h_agent.py`, speaks A2A). What remains is standing up the
GPU box at the event.

## Local rehearsal (any laptop, no GPU — works today)

```bash
# terminal 1 — fake "holo serve"
cd nemoclaw
../automation/.venv/bin/uvicorn mock_a2a_server:app --port 8123

# terminal 2 — automation service in nemoclaw mode
cd automation
H_AGENT_MODE=nemoclaw NEMOCLAW_A2A_URL=http://localhost:8123 \
  .venv/bin/uvicorn main:app --port 8000

# terminal 3 — fire a camera-shaped event
cd automation
.venv/bin/python send_fake_event.py spill --zone zone_b
curl -s localhost:8000/runs | python3 -m json.tool | head -40
# h_agent step output should show backend=nemoclaw with the mock answer
```

## GPU box at the event (ask NVIDIA mentors for RTX / DGX Spark access)

1. **Install NemoClaw** (their one-liner installs the stack + OpenShell +
   onboarding wizard):
   ```bash
   curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
   ```

2. **Install HoloDesktop CLI** (H's on-device agent, powered by Holo 3.1):
   ```bash
   git clone https://github.com/hcompai/holo-desktop-cli
   cd holo-desktop-cli && uv sync
   ```

3. **Model inference** — two options:
   - H Models API (needs `HAI_API_KEY`) — easiest.
   - Fully local (the better challenge story): serve the NVIDIA-quantized
     Holo3.1-35B (NVFP4/Q4) on the GPU with any OpenAI-compatible server,
     then point holo at it: `--base-url http://localhost:8080/v1`.

4. **Register into NemoClaw's agent** so Holo is the harness's computer-use
   tool: `holo install` (MCP hosts) or `holo acp` (OpenClaw/Hermes hosts).

5. **Expose the A2A endpoint** for Snowglobe:
   ```bash
   holo serve            # check `holo serve --help` for port/host flags
   ```

6. **Point Snowglobe at the box** — on the machine running automation/:
   ```bash
   # automation/.env
   H_AGENT_MODE=nemoclaw
   NEMOCLAW_A2A_URL=http://<gpu-box-lan-ip>:<holo-serve-port>
   ```
   Restart uvicorn, then `python send_fake_event.py spill --zone zone_b` —
   the h_agent step now executes on the GPU box.

## Notes / verify on the day

- Exact `holo serve` port + whether its A2A method names match
  (`message/send`, `tasks/get`) — our client is tolerant but check
  `holo serve --help` and one curl before the demo.
- Both machines must be on the same network (hackathon wifi may isolate
  clients — a phone hotspot is the classic workaround).
- The hosted API fallback (`H_AGENT_MODE=agent_api`, verified working) stays
  one env var away if the GPU box misbehaves on stage.
