import { useMemo, useState } from 'react'
import type { Store } from '../store'
import type { EventType, Run } from '../types'
import { eventMeta } from '../constants'
import { timeAgo } from '../util'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EventIcon } from '../components/ui-kit'

type ActionFilter = 'all' | 'action_needed' | 'action_done' | 'no_action_needed'
type ActionState = 'action_needed' | 'action_done' | 'no_action_needed'

function getActionState(eventId: string, runsByEvent: Map<string, Run[]>): ActionState {
  const runs = runsByEvent.get(eventId) ?? []
  if (runs.length === 0) return 'no_action_needed'

  const running = runs.some((run) => run.status === 'running')
  const failed = runs.some((run) => run.status === 'failed')
  const done = runs.some((run) => run.status === 'done')

  if (running || failed) return 'action_needed'
  if (done) return 'action_done'
  return 'no_action_needed'
}

function actionLabel(state: ActionState) {
  if (state === 'action_needed') return 'Action needed'
  if (state === 'action_done') return 'Action done'
  return 'No action needed'
}

function actionClasses(state: ActionState) {
  if (state === 'action_needed') return 'bg-amber-500/10 border-amber-500/40 text-amber-500'
  if (state === 'action_done') return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500'
  return 'bg-muted border-muted text-muted-foreground'
}

export function Events({ store }: { store: Store }) {
  const [filter, setFilter] = useState<EventType | 'all'>('all')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')

  const runsByEvent = useMemo(() => {
    const map = new Map<string, Run[]>()
    for (const run of store.runs) {
      const eventId = run.event?.event_id
      if (!eventId) continue
      const existing = map.get(eventId)
      if (existing) existing.push(run)
      else map.set(eventId, [run])
    }
    return map
  }, [store.runs])

  const rows = useMemo(() => {
    return store.events.filter((event) => {
      const byType = filter === 'all' || event.event_type === filter
      if (!byType) return false
      const state = getActionState(event.event_id, runsByEvent)
      if (actionFilter === 'all') return true
      return actionFilter === state
    })
  }, [store.events, filter, actionFilter, runsByEvent])

  const counts = useMemo(() => {
    let actionNeeded = 0
    let actionDone = 0
    let noActionNeeded = 0
    for (const e of store.events) {
      const state = getActionState(e.event_id, runsByEvent)
      if (state === 'action_needed') actionNeeded += 1
      if (state === 'action_done') actionDone += 1
      if (state === 'no_action_needed') noActionNeeded += 1
    }
    return { actionNeeded, actionDone, noActionNeeded }
  }, [store.events, runsByEvent])

  // Filter chips are derived from the event types actually seen in the log, so
  // any type the perception model surfaces appears automatically.
  const presentTypes = useMemo(() => {
    const seen = new Set<string>()
    for (const e of store.events) seen.add(e.event_type)
    return [...seen].sort()
  }, [store.events])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">Event log</h2>
          <span className="text-sm text-muted-foreground">{store.events.length} events</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={actionFilter === 'all' ? 'default' : 'outline'}
            onClick={() => setActionFilter('all')}
          >
            All ({store.events.length})
          </Button>
          <Button
            size="sm"
            variant={actionFilter === 'action_needed' ? 'default' : 'outline'}
            onClick={() => setActionFilter('action_needed')}
          >
            Action needed ({counts.actionNeeded})
          </Button>
          <Button
            size="sm"
            variant={actionFilter === 'action_done' ? 'default' : 'outline'}
            onClick={() => setActionFilter('action_done')}
          >
            Action done ({counts.actionDone})
          </Button>
          <Button
            size="sm"
            variant={actionFilter === 'no_action_needed' ? 'default' : 'outline'}
            onClick={() => setActionFilter('no_action_needed')}
          >
            No action needed ({counts.noActionNeeded})
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">Filter by type</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
          >
            All types
          </Button>
          {presentTypes.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={filter === t ? 'default' : 'outline'}
              onClick={() => setFilter(t)}
              className="gap-1"
            >
              <EventIcon type={t} className="size-3.5" />
              {eventMeta(t).label}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No events match this filter.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {rows.map((e) => {
                const m = eventMeta(e.event_type)
                const actionState = getActionState(e.event_id, runsByEvent)
                const runs = runsByEvent.get(e.event_id) ?? []
                return (
                  <div key={e.event_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" style={{ color: m.color }}>
                      <EventIcon type={e.event_type} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {m.label}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {e.location}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {typeof e.payload?.count === 'number' && `count ${e.payload.count} · `}
                        {typeof e.payload?.detail === 'string' && `${e.payload.detail} · `}
                        <span className="font-mono">{e.event_id}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={actionClasses(actionState)}>
                          {actionLabel(actionState)}
                        </Badge>
                        {runs.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {runs
                              .map((run) => run.workflow_name || run.workflow_id)
                              .slice(0, 2)
                              .join(' · ')}
                            {runs.length > 2 ? ' · ...' : ''}
                          </span>
                        )}
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
