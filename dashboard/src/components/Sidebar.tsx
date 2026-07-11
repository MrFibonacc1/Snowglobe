import {
  IconGrid,
  IconCamera,
  IconPlug,
  IconBolt,
  IconList,
  IconFlask,
  IconActivity,
} from './icons'

export type View =
  | 'overview'
  | 'cameras'
  | 'integrations'
  | 'automations'
  | 'runs'
  | 'events'
  | 'testing'

interface Props {
  view: View
  onChange: (v: View) => void
  counts: { cameras: number; integrations: number; automations: number }
}

const NAV: { id: View; label: string; icon: JSX.Element }[] = [
  { id: 'overview', label: 'Overview', icon: <IconGrid size={17} /> },
  { id: 'cameras', label: 'Cameras', icon: <IconCamera size={17} /> },
  { id: 'integrations', label: 'Integrations', icon: <IconPlug size={17} /> },
  { id: 'automations', label: 'Workflows', icon: <IconBolt size={17} /> },
  { id: 'runs', label: 'Runs', icon: <IconActivity size={17} /> },
  { id: 'events', label: 'Event log', icon: <IconList size={17} /> },
  { id: 'testing', label: 'Testing', icon: <IconFlask size={17} /> },
]

export function Sidebar({ view, onChange, counts }: Props) {
  const countFor = (id: View) =>
    id === 'cameras'
      ? counts.cameras
      : id === 'integrations'
        ? counts.integrations
        : id === 'automations'
          ? counts.automations
          : undefined

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="2" />
            <circle cx="12" cy="12" r="2.5" fill="white" />
          </svg>
        </div>
        <div>
          <div className="brand-name">Snowglobe</div>
          <div className="brand-sub">Console</div>
        </div>
      </div>

      {NAV.map((n) => {
        const c = countFor(n.id)
        return (
          <button
            key={n.id}
            className={`nav-item ${view === n.id ? 'active' : ''}`}
            onClick={() => onChange(n.id)}
          >
            {n.icon}
            {n.label}
            {c !== undefined && <span className="count">{c}</span>}
          </button>
        )
      })}

      <div className="nav-spacer" />
      <div className="sidebar-foot">
        Ambient perception → agentic action.
      </div>
    </aside>
  )
}
