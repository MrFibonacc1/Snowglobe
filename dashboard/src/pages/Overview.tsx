import type { Store } from '../store'
import { eventMeta } from '../constants'
import { timeAgo } from '../util'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusDot, EventIcon } from '../components/ui-kit'
import {
  Camera,
  Plug,
  Zap,
  List,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react'

export function Overview({ store }: { store: Store }) {
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

  return (
    <div className="flex flex-col gap-6">
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

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Live event feed</CardTitle>
            <Badge variant="secondary" className="gap-1.5">
              <StatusDot status={store.live ? 'live' : 'offline'} />
              {store.live ? 'streaming' : 'paused'}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border/60">
            {store.events.slice(0, 7).map((e) => {
              const m = eventMeta(e.event_type)
              return (
                <div key={e.event_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" style={{ color: m.color }}>
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
              <div className="py-8 text-center text-sm text-muted-foreground">
                No events yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Agent activity</CardTitle>
            {useRuns && <Badge variant="secondary">live runs</Badge>}
          </CardHeader>
          <CardContent>
            {useRuns ? (
              <div className="flex flex-col divide-y divide-border/60">
                {store.runs.slice(0, 7).map((run) => {
                  const done = run.steps.filter((s) => s.status === 'done').length
                  return (
                    <div key={run.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <RunIcon status={run.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {run.workflow_name ?? run.workflow_id}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {eventMeta(run.event.event_type).label} in {run.event.location}
                          {' · '}
                          {done}/{run.steps.length} steps
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {run.started_at ? timeAgo(run.started_at) : ''}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : store.activity.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No agent runs yet. Turn on <b>Live</b> to watch workflows fire.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border/60">
                {store.activity.slice(0, 7).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <RunIcon status={a.status === 'running' ? 'running' : 'done'} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.automation}</div>
                      <div className="truncate text-xs text-muted-foreground">{a.detail}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{timeAgo(a.time)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
