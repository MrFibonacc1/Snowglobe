# dashboard

The Snowglobe console, a single-page app to connect cameras, manage
integrations, wire up automations, and watch the live event feed and agent
activity.

Vite + React + TypeScript, no UI-library dependencies (hand-rolled CSS design
system in `src/index.css`).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build to dist/
```

## How it talks to the backend

Set `VITE_AUTOMATION_URL` (see `.env.example`) to the `automation/` service.
When reachable, the dashboard polls `GET {url}/events` for live events. When
it is not, it falls back to a local simulation so the UI always demos. State
(cameras, integrations, automations) persists to `localStorage`; **Reset demo**
clears it.

## Pages

- **Overview**: stat tiles, live event feed, agent-activity panel.
- **Cameras**: connect a webcam / RTSP / HLS / clip, pick a zone and which
  event types to detect; pause/resume/remove.
- **Integrations**: connect H Company Agent, Google Drive/Sheets, Slack,
  Gradium Voice, custom webhooks; or create a new integration target.
- **Automations**: rules mapping an event type (+ zone + confidence
  threshold) to a set of integration actions.
- **Event log**: full, filterable event history.

## Structure

```
src/
  App.tsx            # shell + view switching
  store.ts           # state, localStorage, live polling + simulation
  types.ts           # mirrors shared/event_schema.json + config entities
  constants.ts       # event-type / category / source metadata
  mockData.ts        # seed cameras, integration catalog, automations, events
  components/         # Sidebar, Modal, icons
  pages/             # Overview, Cameras, Integrations, Automations, Events
```

`Go live` in the top bar starts the event stream.
