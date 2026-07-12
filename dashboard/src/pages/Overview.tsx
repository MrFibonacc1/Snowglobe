import { useEffect, useMemo, useState } from 'react'
import type { Store } from '../store'
import type { Run } from '../types'
import { eventMeta } from '../constants'
import { timeAgo } from '../util'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusDot, EventIcon } from '../components/ui-kit'
import { VideoCapture } from '../components/VideoCapture'
import { LiveAgentViewer, agentSessionFromRun } from '../components/LiveAgentViewer'
import { api } from '../api'
import {
  Camera,
  Plug,
  Zap,
  List,
  Check,
  Loader2,
  AlertTriangle,
  Bot,
  Sparkles,
} from 'lucide-react'

export function Overview({ store, onOpenRun }: { store: Store; onOpenRun?: (id: string) => void }) {
  const liveCams = store.cameras.filter((c) => c.status === 'live').length
  const connectedInts = store.integrations.filter((i) => i.status === 'connected').length
  const enabledAutos = store.workflows.filter((w) => w.enabled).length
  const dayCutoff = Date.now() - 24 * 60 * 60 * 1000
  const eventsToday = store.events.filter((e) => {
    const ts = Date.parse(e.timestamp)
    return !Number.isNaN(ts) && ts >= dayCutoff
  }).length

  const useRuns = store.runs.length > 0

  const stats = [
    { label: 'Live cameras', value: `${liveCams}/${store.cameras.length}`, icon: Camera },
    { label: 'Integrations connected', value: String(connectedInts), icon: Plug },
    { label: 'Workflows active', value: String(enabledAutos), icon: Zap },
    { label: 'Events today', value: String(eventsToday), icon: List },
  ]

  // Run IDs the VideoCapture tile kicked off. We poll them to surface the
  // spawned agent live, right here in the bento (the "watch it move" box).
  const [agentRunIds, setAgentRunIds] = useState<string[]>([])
  const { viewerRun, hero } = useAgentRuns(store, agentRunIds)
  const agentActive = hero

  return (
    <div className="flex flex-col gap-4">
      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Bento grid. When an agent spawns, its live view takes the hero slot. */}
      <div className="grid auto-rows-min gap-4 lg:grid-cols-3">
        {/* Video insertion — upload / live camera / browser camera */}
        <Card className={agentActive ? 'lg:col-span-1' : 'lg:col-span-2'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Video
            </CardTitle>
            {(store.live || (viewerRun?.status === 'running')) && (
              <Badge variant="secondary" className="gap-1.5">
                <StatusDot status="live" /> live
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            <VideoCapture store={store} onRunsStarted={setAgentRunIds} />
          </CardContent>
        </Card>

        {/* Live agent view — the hero when an agent is running */}
        <Card className={agentActive ? 'lg:col-span-2 lg:row-span-2' : 'lg:col-span-1'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" /> Agent activity
            </CardTitle>
            {viewerRun && (
              <Badge
                variant="outline"
                className={
                  viewerRun.status === 'running'
                    ? 'border-primary/40 text-primary'
                    : 'border-emerald-500/40 text-emerald-500'
                }
              >
                {viewerRun.status === 'running' ? 'working' : 'done'}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {viewerRun ? (
              <AgentBox run={viewerRun} />
            ) : (
              <AgentActivityList store={store} useRuns={useRuns} onOpenRun={onOpenRun} />
            )}
          </CardContent>
        </Card>

        {/* Live event feed */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Live event feed</CardTitle>
            <Badge variant="secondary" className="gap-1.5">
              <StatusDot status={store.live ? 'live' : 'offline'} />
              {store.live ? 'streaming' : 'paused'}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
            {store.events.slice(0, 8).map((e) => {
              const m = eventMeta(e.event_type)
              return (
                <div
                  key={e.event_id}
                  className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0"
                >
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"
                    style={{ color: m.color }}
                  >
                    <EventIcon type={e.event_type} className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {e.location}
                      {typeof e.payload?.count === 'number' && ` · ${e.payload.count} people`}
                      {typeof e.payload?.detail === 'string' && ` · ${e.payload.detail}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums" style={{ color: m.color }}>
                      {Math.round(e.confidence * 100)}%
                    </div>
                    <div className="text-xs text-muted-foreground">{timeAgo(e.timestamp)}</div>
                  </div>
                </div>
              )
            })}
            {store.events.length === 0 && (
              <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                No events yet. Insert a video above or turn on <b>Live</b>.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Picks the run to feature in the agent viewer: prefer a run this page started,
// otherwise the most recent run in the store that has an H session to show.
function useAgentRuns(store: Store, agentRunIds: string[]) {
  const [tracked, setTracked] = useState<Run[]>([])

  useEffect(() => {
    if (!agentRunIds.length || !api.configured()) {
      setTracked([])
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    const maxMs = 300_000

    const tick = async () => {
      const fetched = await Promise.all(agentRunIds.map((id) => api.getRun(id).catch(() => null)))
      if (cancelled) return
      const next = fetched.filter((r): r is Run => !!r)
      setTracked(next)
      const allDone = next.length === agentRunIds.length && next.every((r) => r.status !== 'running')
      if (!allDone && Date.now() - startedAt < maxMs) timer = setTimeout(tick, 2500)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [agentRunIds])

  const activeRun = useMemo(
    () => tracked.find((r) => r.status === 'running') ?? tracked[0] ?? null,
    [tracked],
  )

  // The run to feature: one we're tracking with an H session, else the latest
  // store run that has an agent session (so a run started elsewhere still shows).
  const viewerRun = useMemo(() => {
    const candidates = tracked.length ? tracked : store.runs
    const withSession = candidates.find((r) => agentSessionFromRun(r).sessionId)
    return withSession ?? null
  }, [tracked, store.runs])

  // Expand to the big "hero" live view only when the agent is actually active
  // (a run started from this page, or any run currently running). A stale
  // completed run still renders in the normal-sized box, without hijacking the
  // whole grid on page load.
  const hero = useMemo(
    () => !!viewerRun && (tracked.length > 0 || viewerRun.status === 'running'),
    [viewerRun, tracked.length],
  )

  return { activeRun, viewerRun, hero }
}

function AgentBox({ run }: { run: Run }) {
  const { sessionId, viewUrl } = agentSessionFromRun(run)
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        {run.workflow_name ?? run.workflow_id} ·{' '}
        {eventMeta(run.event.event_type).label} in {run.event.location}
      </div>
      {sessionId ? (
        <LiveAgentViewer sessionId={sessionId} running={run.status === 'running'} viewUrl={viewUrl} />
      ) : (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Spinning up the agent…
        </div>
      )}
    </div>
  )
}

function AgentActivityList({
  store,
  useRuns,
  onOpenRun,
}: {
  store: Store
  useRuns: boolean
  onOpenRun?: (id: string) => void
}) {
  if (useRuns) {
    return (
      <div className="flex flex-col divide-y divide-border/60">
        {store.runs.slice(0, 6).map((run) => {
          const done = run.steps.filter((s) => s.status === 'done').length
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onOpenRun?.(run.id)}
              className="flex w-full items-center gap-3 rounded-md py-2.5 text-left transition first:pt-0 last:pb-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RunIcon status={run.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {run.workflow_name ?? run.workflow_id}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {eventMeta(run.event.event_type).label} in {run.event.location} · {done}/
                  {run.steps.length} steps
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {run.started_at ? timeAgo(run.started_at) : ''}
              </div>
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Bot className="size-8 opacity-40" />
      No agent running yet. Insert a video to spawn one, then watch it work here.
    </div>
  )
}

function RunIcon({ status }: { status: string }) {
  if (status === 'running')
    return <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
  if (status === 'failed')
    return <AlertTriangle className="size-5 shrink-0 text-destructive" />
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
      <Check className="size-3.5" />
    </span>
  )
}
