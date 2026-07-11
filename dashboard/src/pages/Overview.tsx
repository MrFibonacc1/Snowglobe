import type { Store } from '../store'
import { EVENT_META } from '../constants'
import { timeAgo } from '../util'
import { IconCamera, IconPlug, IconBolt, IconList, IconCheck } from '../components/icons'

export function Overview({ store }: { store: Store }) {
  const liveCams = store.cameras.filter((c) => c.status === 'live').length
  const connectedInts = store.integrations.filter((i) => i.status === 'connected').length
  const enabledAutos = store.automations.filter((a) => a.enabled).length
  const eventsToday = store.cameras.reduce((n, c) => n + c.eventsToday, 0)

  const stats = [
    { label: 'Live cameras', value: `${liveCams}/${store.cameras.length}`, icon: <IconCamera size={15} /> },
    { label: 'Integrations connected', value: connectedInts, icon: <IconPlug size={15} /> },
    { label: 'Automations active', value: enabledAutos, icon: <IconBolt size={15} /> },
    { label: 'Events today', value: eventsToday, icon: <IconList size={15} /> },
  ]

  return (
    <div className="stack gap-16">
      <div className="grid grid-4">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <div className="label">
              <span className="stat-icon">{s.icon}</span>
              {s.label}
            </div>
            <div className="value">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div className="card">
          <div className="section-head">
            <h2>Live event feed</h2>
            <div className="spacer" />
            <span className="badge">
              <span className={`dot ${store.live ? 'live' : 'offline'}`} />
              {store.live ? 'streaming' : 'paused'}
            </span>
          </div>
          <div className="feed">
            {store.events.slice(0, 7).map((e) => {
              const m = EVENT_META[e.event_type]
              return (
                <div className="feed-row" key={e.event_id}>
                  <div className="feed-ico">{m.icon}</div>
                  <div className="feed-main">
                    <div className="feed-title">{m.label}</div>
                    <div className="feed-sub">
                      {e.location}
                      {typeof e.payload?.count === 'number' && ` · ${e.payload.count} people`}
                      {typeof e.payload?.detail === 'string' && ` · ${e.payload.detail}`}
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
        </div>

        <div className="card">
          <div className="section-head">
            <h2>Agent activity</h2>
          </div>
          {store.activity.length === 0 ? (
            <div className="empty" style={{ padding: '28px 16px' }}>
              No agent runs yet. Turn on <b>Live</b> to watch automations fire.
            </div>
          ) : (
            <div className="feed">
              {store.activity.slice(0, 7).map((a) => (
                <div className="activity-row" key={a.id}>
                  {a.status === 'running' ? (
                    <div className="spinner" />
                  ) : (
                    <span className="check"><IconCheck size={15} /></span>
                  )}
                  <div className="feed-main">
                    <div className="feed-title">{a.automation}</div>
                    <div className="feed-sub">{a.detail}</div>
                  </div>
                  <div className="feed-time">{timeAgo(a.time)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
