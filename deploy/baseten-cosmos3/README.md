# Cosmos 3 reasoner on Baseten

Deploy NVIDIA's Cosmos physical-AI reasoner (the downloadable `cosmos-reason1-7b`
NIM) as a self-hosted, autoscaling endpoint on Baseten, then point the perception
service at it. This replaces the hosted `nemotron-nano-12b-v2-vl` fallback with a
real Cosmos reasoner running on your own GPU.

> Why this NIM: Cosmos reasoner (`cosmos-reason2-8b`) on build.nvidia.com is a
> hosted-only / deprecated endpoint that 404s for our account. The **downloadable**
> Cosmos reasoner NIM is `nvcr.io/nim/nvidia/cosmos-reason1-7b`, an
> OpenAI-compatible VLM server. That's what we deploy here.

## What this folder contains

| File | Purpose |
| --- | --- |
| `config.yaml` | Truss custom-server ("no-build") config that runs the NIM image on an H100. |
| `test_client.py` | One-shot smoke test: send an image, print the model's answer. |
| `README.md` | This file. |

The perception service already supports a remote endpoint — no code change needed
on your side beyond filling in `perception/.env` (see step 5).

---

## What I need from YOU

Everything below requires your accounts/credentials, so I can't do it from here.
Do these once:

### 1. Accounts + tools
- A **Baseten account** with GPU access (H100). Sign up at https://baseten.co and,
  if H100s aren't enabled yet, request them via their dashboard/support.
- An **NVIDIA NGC API key**: https://org.ngc.nvidia.com/setup/personal-keys
  (create a key with "NGC Catalog" access). This is a *different* key from the
  `nvapi-...` build.nvidia.com key.
- Install the Baseten CLI locally:
  ```bash
  pip install --upgrade truss
  ```

### 2. Store the NGC key as two Baseten secrets
The NIM image lives in NVIDIA's private registry (`nvcr.io`) and downloads weights
at boot, so Baseten needs the key in two forms.

In the Baseten dashboard → **Secrets**, add:

- **`DOCKER_REGISTRY_nvcr.io`** — lets Baseten pull the image. Value is the
  base64 of `$oauthtoken:<your NGC key>`:
  ```bash
  echo -n '$oauthtoken:<YOUR_NGC_API_KEY>' | base64
  ```
  (`$oauthtoken` is a literal string, not a variable — keep it exactly.)

- **`ngc_api_key`** — the raw NGC key (no base64), used at runtime to download
  the model weights. Value is just `<YOUR_NGC_API_KEY>`.

### 3. Log in the CLI
```bash
truss login          # paste a Baseten API key when prompted
```

### 4. Deploy
From the repo root:
```bash
cd deploy/baseten-cosmos3
truss push --publish
```
First boot is slow (10–40 min): Baseten pulls the ~13 GB image, downloads Cosmos
weights, and compiles TRT-LLM engines. Watch the logs in the Baseten dashboard
until the deployment is **active**. `config.yaml` already sets
`startup_threshold_seconds: 3000` so Baseten won't kill it during that window.

Grab two things from the dashboard once it's live:
- the **model endpoint URL**, of the form
  `https://model-<id>.api.baseten.co/environments/production/sync`
- a **Baseten API key** (Settings → API keys)

### 5. Point perception at it
Edit `perception/.env`:
```bash
VLM_API_KEY=<your Baseten API key>
VLM_AUTH_SCHEME=api-key
VLM_BASE_URL=https://model-<id>.api.baseten.co/environments/production/sync/v1
VLM_MODEL=nvidia/cosmos-reason1-7b
```
Note the trailing `/v1` — the NIM serves OpenAI routes under it, so perception hits
`.../sync/v1/chat/completions`.

### 6. Verify
```bash
# From repo root, with the vars above exported or in perception/.env:
python deploy/baseten-cosmos3/test_client.py sample_data/03_grocery_two_shoppers.mp4  # use a .jpg frame
```
or exercise the full pipeline:
```bash
python -m perception --video sample_data/03_grocery_two_shoppers.mp4 --max-frames 4
```
A `HTTP 200` with a sensible description means Cosmos is live end-to-end.

---

## Cost / tuning notes

- **H100** is the default (`resources.accelerator`). It gives the optimized
  TRT-LLM throughput profile. To cut cost, switch to `A100` — it still meets the
  ≥48 GB VRAM floor but runs the slower latency profile. Do **not** go below a
  48 GB single-GPU card.
- Baseten **scales to zero** when idle; the trade-off is a cold start on the next
  request. Set a min replica > 0 in the dashboard if you need consistently low
  latency for a demo.
- Bump the image tag in `config.yaml` as NVIDIA ships newer NIMs — check
  https://catalog.ngc.nvidia.com/orgs/nim/nvidia/containers/cosmos-reason1-7b

## Rolling back to the hosted model

Comment out the four Baseten vars in `perception/.env` (or clear `VLM_API_KEY`
and reset `VLM_BASE_URL`/`VLM_MODEL`). Perception falls back to
`NVIDIA_API_KEY` + the hosted Nemotron endpoint with no code change.
