import { useState } from 'react'
import { useStore } from './store'
import { Sidebar, type View } from './components/Sidebar'
import { Overview } from './pages/Overview'
import { Cameras } from './pages/Cameras'
import { Integrations } from './pages/Integrations'
import { WorkflowBuilder } from './pages/WorkflowBuilder'
import { Runs } from './pages/Runs'
import { Events } from './pages/Events'
import { Testing } from './pages/Testing'

const TITLES: Record<View, { title: string; sub: string }> = {
  overview: { title: 'Overview', sub: 'Live perception and agent activity at a glance' },
  cameras: { title: 'Cameras', sub: 'Connect and monitor your video sources' },
  integrations: { title: 'Integrations', sub: 'Action targets the agent and Composio can drive' },
  automations: { title: 'Workflows', sub: 'Compose detections into ordered agent + Composio steps' },
  runs: { title: 'Runs', sub: 'Live, step-by-step execution of your workflows' },
  events: { title: 'Event log', sub: 'Everything perception has detected' },
  testing: { title: 'Testing', sub: 'Upload an image and run detection through the perception model' },
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
          automations: store.workflows.filter((w) => w.enabled).length,
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
          {view === 'automations' && <WorkflowBuilder store={store} />}
          {view === 'runs' && <Runs store={store} />}
          {view === 'events' && <Events store={store} />}
          {view === 'testing' && <Testing />}
        </div>
      </div>
    </div>
  )
}
