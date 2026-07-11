import { useMemo, useState } from 'react'
import type { Store } from '../store'
import type { EventType } from '../types'
import { eventMeta } from '../constants'
import { timeAgo } from '../util'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EventIcon } from '../components/ui-kit'

export function Events({ store }: { store: Store }) {
  const [filter, setFilter] = useState<EventType | 'all'>('all')
  const rows = store.events.filter((e) => filter === 'all' || e.event_type === filter)

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
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
          >
            All
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
