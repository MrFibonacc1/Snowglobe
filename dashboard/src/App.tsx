import { useState } from 'react'
import { useStore } from './store'
import { AppSidebar, type View } from './components/AppSidebar'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { StatusDot } from './components/ui-kit'
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
    <SidebarProvider>
      <AppSidebar
        view={view}
        onChange={setView}
        counts={{
          cameras: store.cameras.length,
          integrations: store.integrations.filter((i) => i.status === 'connected').length,
          automations: store.workflows.filter((w) => w.enabled).length,
        }}
      />

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-5" />
          <div className="flex-1">
            <h1 className="font-display text-xl font-medium leading-tight tracking-tight">{title}</h1>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={store.live ? 'default' : 'outline'}
              size="sm"
              onClick={() => store.setLive(!store.live)}
              className="gap-2"
            >
              <StatusDot status={store.live ? 'live' : 'offline'} />
              {store.live ? 'Live' : 'Go live'}
            </Button>
            <Button variant="ghost" size="sm" onClick={store.resetDemo}>
              Reset demo
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          {view === 'overview' && <Overview store={store} />}
          {view === 'cameras' && <Cameras store={store} />}
          {view === 'integrations' && <Integrations store={store} />}
          {view === 'automations' && <WorkflowBuilder store={store} />}
          {view === 'runs' && <Runs store={store} />}
          {view === 'events' && <Events store={store} />}
          {view === 'testing' && <Testing />}
        </main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
