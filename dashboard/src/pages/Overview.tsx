import type { Store } from '../store'
import { EVENT_META } from '../constants'
import { timeAgo } from '../util'
import { IconCamera, IconPlug, IconBolt, IconList, IconCheck } from '../components/icons'

export function Overview({ store }: { store: Store }) {
  const liveCams = store.cameras.filter((c) => c.status === 'live').length
  const connectedInts = store.integrations.filter((i) => i.status === 'connected').length
  const enabledAutos = store.workflows.filter((w) => w.enabled).length
  const eventsToday = store.cameras.reduce((n, c) => n + c.eventsToday, 0)

  // Prefer real backend runs; fall back to the local simulation's activity.
  const useRuns = store.runs.length > 0

  const stats = [
    { label: 'Live cameras', value: `${liveCams}/${store.cameras.length}`, icon: <IconCamera size={15} /> },
    { label: 'Integrations connected', value: connectedInts, icon: <IconPlug size={15} /> },
    { label: 'Workflows active', value: enabledAutos, icon: <IconBolt size={15} /> },
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
            <div className="spacer" />
            {useRuns && <span className="badge">live runs</span>}
          </div>
          {useRuns ? (
            <div className="feed">
              {store.runs.slice(0, 7).map((run) => {
                const done = run.steps.filter((s) => s.status === 'done').length
                return (
                  <div className="activity-row" key={run.id}>
                    {run.status === 'running' ? (
                      <div className="spinner" />
                    ) : run.status === 'failed' ? (
                      <span className="tl-dot failed" style={{ marginTop: 5 }} />
                    ) : (
                      <span className="check"><IconCheck size={15} /></span>
                    )}
                    <div className="feed-main">
                      <div className="feed-title">{run.workflow_name ?? run.workflow_id}</div>
                      <div className="feed-sub">
                        {EVENT_META[run.event.event_type]?.label} in {run.event.location}
                        {' · '}{done}/{run.steps.length} steps
                      </div>
                    </div>
                    <div className="feed-time">
                      {run.started_at ? timeAgo(run.started_at) : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : store.activity.length === 0 ? (
            <div className="empty" style={{ padding: '28px 16px' }}>
              No agent runs yet. Turn on <b>Live</b> to watch workflows fire.
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
