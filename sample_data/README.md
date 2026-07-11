# sample_data

Five curated demo clips, each chosen because the perception pipeline produces a
**notable, verified detection** on it with the real NVIDIA VLM
(`nvidia/nemotron-nano-12b-v2-vl`). Two of them drive the seeded automation
workflows all the way through their steps (not just a skipped condition).

All clips are royalty-free stock (Mixkit), 720p, a few seconds each.

| # | File | Scene | What the VLM detects | Workflow effect |
|---|------|-------|----------------------|-----------------|
| 01 | `01_spill_floor.mp4` | Liquid splashing on a floor | `spill` on ~11/12 frames, up to **0.95** confidence ("Multiple splashes of liquid on the floor") | Fires **`wf_spill_incident`** → `h_agent` + `composio` steps run |
| 02 | `02_crowd_over_capacity.mp4` | Packed street junction, top-down | `person_count` **25–150**, `foot_traffic` high | Fires **`wf_occupancy`** → condition `count > 20` **passes** → `composio` alert |
| 03 | `03_grocery_two_shoppers.mp4` | Shopper with cart in an aisle | `person_count` = **2**, conf ~1.0, no false spills | Clean occupancy baseline (condition does not pass) |
| 04 | `04_grocery_produce_shopper.mp4` | One person in the produce aisle | `person_count` = **1**, conf ~0.95 | Single-occupant baseline |
| 05 | `05_foot_traffic_street.mp4` | People moving down a street | `person_count` ~5–10, `foot_traffic` ~10 | Moderate throughput baseline |

## Run one through the pipeline

From the repo root, with `perception/.env` configured (`NVIDIA_API_KEY`,
`AUTOMATION_URL`), the automation service running, and the venv active:

```bash
source perception/.venv/bin/activate

# The notable one — spill triggers the full incident workflow:
python -m perception --source sample_data/01_spill_floor.mp4 --zone aisle_5 \
  --events spill,person_count,safety_violation --fps 1 --limit 12

# The crowd one — trips the over-capacity condition:
python -m perception --source sample_data/02_crowd_over_capacity.mp4 --zone entrance \
  --events person_count,foot_traffic --fps 1 --limit 10
```

Add `--mock` to run without an API key (deterministic fake verdicts), or
`--dump out.jsonl` to write events to a file instead of POSTing to `automation/`.

## Notes

- Counts on dense crowds (clip 02) are rough VLM estimates, not detection-based
  tracking — directionally correct and more than enough to exercise the
  `count > 20` occupancy rule.
- These clips are for **testing/demo** of the zero-shot perception pipeline;
  the system does no training, so no labels are included.
- Source: Mixkit free stock video (no attribution required).
