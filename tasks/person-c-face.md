# Task brief — Person C: "Face" (dashboard + demo)

Upgrade the EXISTING dashboard (`dashboard/` — already built and working,
read [dashboard/README.md](../dashboard/README.md) and run it first) from
mock-backed to real, and turn its Automations page into the workflow builder.
Read [PLAN.md](../PLAN.md) §Data contracts and [CLAUDE.md](../CLAUDE.md).

## What already exists

React/Vite/TS app: sidebar shell, Overview (stats + live feed + agent
activity), Cameras (connect modal), Integrations (connect/create), a simple
Automations page (trigger → action pills), Event log. State in localStorage
(`src/store.ts`) with an event simulation fallback. Design system in
`src/index.css` — reuse its classes; don't add a UI library.

## Deliverables

1. **Workflow builder** (replace the Automations page): edits workflow
   objects per [shared/workflow_schema.json](../shared/workflow_schema.json).
   - Trigger panel: event type, optional zone, min-confidence slider,
     cooldown seconds.
   - Ordered step list: add / remove / reorder (up-down buttons are fine;
     drag-drop only if hours remain). Per-type config forms:
     - `h_agent`: task kind select (google_form / ticket / custom_url), URL,
       instructions textarea with a hint listing `{{event.*}}` variables.
     - `composio`: action select (drive_upload / sheets_append /
       slack_message) + param fields.
     - `condition`: expression input.
   - Save via `POST/PUT /workflows`.
2. **Live runs view** (new page "Runs", also replaces Overview's
   agent-activity panel): poll `GET /runs` every ~2s; per-run card = workflow
   name, triggering event summary, step timeline with pending/running/done/
   failed states (reuse `.spinner`, `.check`), replay link/screenshot from
   h_agent step output. This is the demo money shot — make it gorgeous.
3. **API wiring** (`src/api.ts`): if `VITE_AUTOMATION_URL` responds, use real
   `/events`, `/workflows`, `/runs` and keep localStorage/simulation as the
   offline fallback (never show a broken empty UI — the current
   fallback-if-unreachable pattern in `store.ts` already does this for
   events; extend it).
4. **Cameras page**: show latest snapshot image per camera when perception
   provides `snapshot_url`s.
5. **Demo ownership**: fallback screen-recordings of successful runs, the
   90-second script from PLAN.md rehearsed, a 3-slide deck (problem → live
   demo → "anyone can wire the physical world to any software").

## Interfaces

- **Consumes:** Person B's REST API (shapes in PLAN.md §Data contracts).
  Until it exists, develop against the schemas with mock data.
- **Produces:** nothing others consume — but you own the demo, so you set
  the bar for what "working" must look like on stage.

## Acceptance

- With the backend up: build a new workflow in the UI from scratch, trigger
  it with `send_fake_event.py`, watch its run progress step-by-step live in
  the Runs view without reloading.
- With the backend down: app still renders with simulated data (no blank
  screens, no console errors).
- `npm run build` passes clean.
