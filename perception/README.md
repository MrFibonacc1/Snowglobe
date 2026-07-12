# perception

Video in → Cosmos 3 Reasoner detections → events out.

Samples frames (~0.3 fps, one every ~3s) from a webcam, RTSP stream, or clip; sends each to
NVIDIA's Cosmos 3 Reasoner (physical-AI VLM) via NIM with one prompt per event
type; normalizes responses into the [shared event schema](../shared/event_schema.json);
and POSTs them to `automation/`'s `/events` endpoint.

## Run

One-time setup (from inside `perception/`):

```bash
cd perception
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in NVIDIA_API_KEY (or use --mock)
```

Run everything from the repo root (`companyH/`), not from `perception/`,
because `perception` has to be importable as a package. Keep the venv activated:

```bash
cd ..                                   # back to companyH/ (repo root)
source perception/.venv/bin/activate    # if not already active

# Offline smoke test, no API key, no camera:
python -m perception.make_test_clip --out demo/synthetic.mp4
python -m perception --source demo/synthetic.mp4 --zone zone_b --mock \
  --events spill,person_count,safety_violation,foot_traffic --dump out.jsonl

# Real detection against a clip, POSTing to automation/:
python -m perception --source demo/spill.mp4 --zone zone_b

# Live webcam:
python -m perception --source webcam --zone zone_a

# Detect API for the dashboard Testing page:
python -m perception.server                 # http://localhost:8008
# (equivalently: uvicorn perception.server:app --port 8008 --app-dir .)

# Static host for saved frames (so snapshot_url resolves):
python -m perception.snapshot_server        # http://localhost:8001/snapshots/...
```

`.env` is loaded automatically by absolute path, so the commands above pick up
your `NVIDIA_API_KEY` from any working directory.

## Files

| File | Role |
|---|---|
| `sampler.py` | OpenCV capture; frame skipping (files) or wall-clock gating (live); saves JPEGs to `snapshots/` |
| `vlm.py` | `VLMDetector` (Cosmos 3 via NIM) + `MockDetector` (offline); defensive JSON extraction that strips `<think>…</think>` |
| `prompts.py` | One prompt per event type; all return `{detected, confidence, count, detail}` |
| `emit.py` | Builds schema-valid events (validates via `jsonschema`), POSTs or dumps JSONL |
| `pipeline.py` | Orchestration + `TrafficAggregator` |
| `__main__.py` | CLI |
| `snapshot_server.py` | Static host for saved frames |
| `make_test_clip.py` | Synthetic clip generator for offline tests |

## Notes / decisions

- **Model** is configurable (`VLM_MODEL` / `--model`). Default is
  `nvidia/nemotron-nano-12b-v2-vl`, a Nemotron-VL model verified working on
  hosted inference (build.nvidia.com); it reads frames and returns our JSON
  verdict. NVIDIA's Cosmos physical-AI reasoner (`nvidia/cosmos-reason2-8b`)
  is the intended primary, but it 404s on hosted inference for our account.
  It needs a self-hosted NIM container / GPU access. Point `VLM_BASE_URL` at
  that NIM and set `VLM_MODEL=nvidia/cosmos-reason2-8b` once GPUs are
  available. The NIM call is OpenAI-compatible chat-completions with a base64
  image part, so any of these drop in without code changes.
- **`foot_traffic` is derived from `person_count`** over a sliding window
  (`--traffic-window`, default 30s), not a separate per-frame model call,
  since throughput is inherently temporal. A `foot_traffic` prompt still exists in
  `prompts.py` if you want per-frame throughput instead.
- **Dedup:** the automation engine owns cooldown/dedup (one spill → one run).
  `--cooldown` adds an optional perception-side debounce for standalone
  `--dump` runs; it's off by default.
- **`--mock`** produces deterministic verdicts from a frame hash so the whole
  pipeline runs with no API key. Use it to develop against `automation/` and
  the dashboard before touching credits.
