import { useState } from 'react'
import type { Store } from '../store'
import type { EventType } from '../types'
import { EVENT_META, EVENT_TYPES } from '../constants'
import { timeAgo } from '../util'

export function Events({ store }: { store: Store }) {
  const [filter, setFilter] = useState<EventType | 'all'>('all')
  const rows = store.events.filter((e) => filter === 'all' || e.event_type === filter)

  return (
    <div className="stack gap-16">
      <div className="section-head">
        <h2>Event log</h2>
        <span className="muted">{store.events.length} events</span>
        <div className="spacer" />
        <div className="row wrap gap-6">
          <button
            className={`pill-check ${filter === 'all' ? 'sel' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          {EVENT_TYPES.map((t) => (
            <button
              key={t}
              className={`pill-check ${filter === t ? 'sel' : ''}`}
              onClick={() => setFilter(t)}
            >
              {EVENT_META[t].icon} {EVENT_META[t].label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty" style={{ border: 'none' }}>
            No events match this filter.
          </div>
        ) : (
          <div className="feed">
            {rows.map((e) => {
              const m = EVENT_META[e.event_type]
              return (
                <div className="feed-row" key={e.event_id}>
                  <div className="feed-ico">{m.icon}</div>
                  <div className="feed-main">
                    <div className="feed-title">
                      {m.label}
                      <span className="faint" style={{ fontWeight: 400 }}>
                        {'  ·  '}{e.location}
                      </span>
                    </div>
                    <div className="feed-sub">
                      {typeof e.payload?.count === 'number' && `count ${e.payload.count} · `}
                      {typeof e.payload?.detail === 'string' && `${e.payload.detail} · `}
                      <span style={{ fontFamily: 'monospace' }}>{e.event_id}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="conf" style={{ color: m.color }}>
                      {Math.round(e.confidence * 100)}%
                    </div>
                    <div className="feed-time">{timeAgo(e.timestamp)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
