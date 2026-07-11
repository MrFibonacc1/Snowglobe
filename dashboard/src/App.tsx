import { useState } from 'react'
import { useStore } from './store'
import { Sidebar, type View } from './components/Sidebar'
import { Overview } from './pages/Overview'
import { Cameras } from './pages/Cameras'
import { Integrations } from './pages/Integrations'
import { Automations } from './pages/Automations'
import { Events } from './pages/Events'

const TITLES: Record<View, { title: string; sub: string }> = {
  overview: { title: 'Overview', sub: 'Live perception and agent activity at a glance' },
  cameras: { title: 'Cameras', sub: 'Connect and monitor your video sources' },
  integrations: { title: 'Integrations', sub: 'Action targets the agent and Composio can drive' },
  automations: { title: 'Automations', sub: 'Turn detections into actions' },
  events: { title: 'Event log', sub: 'Everything perception has detected' },
}

export default function App() {
  const store = useStore()
  const [view, setView] = useState<View>('overview')
  const { title, sub } = TITLES[view]

  return (
    <div className="app">
      <Sidebar
        view={view}
        onChange={setView}
        counts={{
          cameras: store.cameras.length,
          integrations: store.integrations.filter((i) => i.status === 'connected').length,
          automations: store.automations.filter((a) => a.enabled).length,
        }}
      />

      <div className="main">
        <div className="topbar">
          <div>
            <h1>{title}</h1>
            <div className="sub">{sub}</div>
          </div>
          <div className="topbar-right">
            <button
              className="live-toggle"
              onClick={() => store.setLive(!store.live)}
            >
              <span className={`dot ${store.live ? 'live' : 'offline'}`} />
              {store.live ? 'Live' : 'Go live'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={store.resetDemo}>
              Reset demo
            </button>
          </div>
        </div>

        <div className="content">
          {view === 'overview' && <Overview store={store} />}
          {view === 'cameras' && <Cameras store={store} />}
          {view === 'integrations' && <Integrations store={store} />}
          {view === 'automations' && <Automations store={store} />}
          {view === 'events' && <Events store={store} />}
        </div>
      </div>
    </div>
  )
}
