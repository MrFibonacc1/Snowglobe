# sample_data

## Verified demo clips (01-05)

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

## CCTV evaluation clips (06-11)

These are fixed-camera or surveillance-style evaluation clips collected from
public, reusable sources. They have been visually checked, but their VLM outputs
have **not** been characterized yet, so they are separate from the verified demo
set above.

| # | File | Scene | Format | Suggested evaluation |
|---|------|-------|--------|----------------------|
| 06 | `06_warehouse_corner_cctv.mp4` | Real warehouse, elevated corner camera; workers, pallet racks, boxes | 60 s, 1920x1080 H.264 MP4 | Person count, PPE/hazard reasoning, aisle activity |
| 07 | `07_shopping_center_entry_corridor_cctv.mp4` | Shopping-centre corridor camera; people cross paths and enter/exit a store | 15.3 s, 384x288, 25 fps H.264 MP4 | Person count and foot traffic; synchronized with clip 08 |
| 08 | `08_shopping_center_entry_front_cctv.mp4` | Front-facing camera on the same store-entrance event as clip 07 | 15.3 s, 384x288, 25 fps H.264 MP4 | Cross-view consistency and store entry/exit |
| 09 | `09_shopping_center_assistant_cctv.mp4` | Shopping-centre corridor with customer/shop-assistant interaction | 67 s, 384x288, 25 fps H.264 MP4 | Person count and retail activity description |
| 10 | `10_bank_tornado_cctv.mp4` | Actual fixed bank CCTV during a tornado impact | 39.4 s, 1272x718 H.264 MP4 | Environmental hazard and incident description |
| 11 | `11_warehouse_loading_dock.mp4` | Warehouse loading dock with workers and equipment; static reference shot, not CCTV | 20.3 s, 1920x1080 H.264 MP4 | Person count and warehouse activity baseline |

Every clip in this main folder is H.264 MP4 with `yuv420p` pixel format and
fast-start metadata so editor and browser previews work. Clips 07-11 were
transcoded without audio; their unchanged source MPEG/WebM files are retained in
`source_originals/`. A sequential check through `perception.sampler`
successfully decoded all six MP4s and produced 216 total frames at 1 fps.

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

# Real fixed-camera warehouse footage:
python -m perception --source sample_data/06_warehouse_corner_cctv.mp4 \
  --zone warehouse_aisle --events person_count,foot_traffic,safety_violation \
  --fps 1 --limit 30
```

Add `--mock` to run without an API key (deterministic fake verdicts), or
`--dump out.jsonl` to write events to a file instead of POSTing to `automation/`.

## Notes

- Counts on dense crowds (clip 02) are rough VLM estimates, not detection-based
  tracking — directionally correct and more than enough to exercise the
  `count > 20` occupancy rule.
- These clips are for **testing/demo** of the zero-shot perception pipeline;
  the system does no training, so no labels are included.
- Clips 01-05: Mixkit free stock video (no attribution required).

## Sources and licenses

Retrieved 2026-07-11. Keep these attributions with any redistributed copies.

- **06 — NVIDIA Physical AI Smart Spaces.** Original file:
  [`MTMC_Tracking_2026/test/Warehouse_026/videos/Camera_0000.mp4`](https://huggingface.co/datasets/nvidia/PhysicalAI-SmartSpaces/blob/main/MTMC_Tracking_2026/test/Warehouse_026/videos/Camera_0000.mp4).
  The [dataset card](https://huggingface.co/datasets/nvidia/PhysicalAI-SmartSpaces)
  identifies `Warehouse_026` as a real-world warehouse capture and licenses the
  dataset under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **07-09 — EC-funded CAVIAR project, IST 2001-37540.** The
  [official dataset page](https://groups.inf.ed.ac.uk/vision/DATASETS/CAVIAR/CAVIARDATA1/)
  describes the Lisbon shopping-centre cameras and marks the data **CC BY-SA**
  (the source does not specify a license version). Original files:
  [07 corridor](https://groups.inf.ed.ac.uk/vision/DATASETS/CAVIAR/CAVIARDATA2/EnterExitCrossingPaths1cor/EnterExitCrossingPaths1cor.mpg),
  [08 front](https://groups.inf.ed.ac.uk/vision/DATASETS/CAVIAR/CAVIARDATA2/EnterExitCrossingPaths1front/EnterExitCrossingPaths1front.mpg), and
  [09 corridor](https://groups.inf.ed.ac.uk/vision/DATASETS/CAVIAR/CAVIARDATA2/ShopAssistant1cor/ShopAssistant1cor.mpg).
- **10 — First National Bank (Mayfield, Kentucky).** The
  [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:First_National_Bank_Mayfield_CCTV.webm)
  classifies the fixed-camera recording as public domain under its automated
  CCTV rationale and notes that treatment can vary by jurisdiction.
- **11 — `domdomegg`.** [Amazon warehouse BHX4 loading docks 2](https://commons.wikimedia.org/wiki/File:Amazon_warehouse_BHX4_loading_docks_2.webm),
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The local
  MP4 is a video-only H.264 transcode; the unchanged WebM is in
  `source_originals/`.
