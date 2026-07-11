import type { Store } from '../store'
import type { Run, RunStep } from '../types'
import { EVENT_META } from '../constants'
import { timeAgo } from '../util'
import { IconCheck, IconArrow } from '../components/icons'

export function Runs({ store }: { store: Store }) {
  const runs = store.runs

  return (
    <div className="stack gap-16">
      {store.backendOnline === false && (
        <div className="banner warn">
          Automation backend unreachable — no live runs. Start it with{' '}
          <code>uvicorn main:app --port 8000</code>, then Go live.
        </div>
      )}

      <div className="section-head">
        <h2>Runs</h2>
        <span className="muted">{runs.length} recent</span>
        <div className="spacer" />
        <span className="badge">
          <span className={`dot ${store.live ? 'live' : 'offline'}`} />
          {store.live ? 'polling /runs' : 'paused — Go live'}
        </span>
      </div>

      {runs.length === 0 ? (
        <div className="empty">
          No runs yet. Go live and trigger a workflow (or use its <b>Test</b>{' '}
          button) to watch steps execute here in real time.
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}

function RunCard({ run }: { run: Run }) {
  const m = EVENT_META[run.event.event_type]
  return (
    <div className="run-card">
      <div className="row between">
        <div className="row gap-6">
          <span className="feed-ico">{m?.icon ?? '•'}</span>
          <div>
            <div className="feed-title">{run.workflow_name ?? run.workflow_id}</div>
            <div className="feed-sub">
              {m?.label ?? run.event.event_type} in {run.event.location}
              {' · '}
              {Math.round(run.event.confidence * 100)}%
            </div>
          </div>
        </div>
        <span className={`run-status ${run.status}`}>{run.status}</span>
      </div>

      <div className="timeline">
        {run.steps.map((step, i) => (
          <StepRow key={step.id} step={step} last={i === run.steps.length - 1} />
        ))}
      </div>

      <div className="row between">
        <span className="feed-time">
          {run.started_at ? timeAgo(run.started_at) : ''}
        </span>
        <span className="faint" style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {run.id}
        </span>
      </div>
    </div>
  )
}

function StepRow({ step }: { step: RunStep; last: boolean }) {
  const out = step.output ?? {}
  const replay = (out.agent_view_url as string) || (out.replay_url as string) || null
  return (
    <div className="tl-step">
      <div className="tl-marker">
        {step.status === 'running' ? (
          <div className="spinner" style={{ margin: 0 }} />
        ) : step.status === 'done' ? (
          <span className="check" style={{ margin: 0 }}>
            <IconCheck size={14} />
          </span>
        ) : (
          <span className={`tl-dot ${step.status}`} />
        )}
      </div>
      <div className="tl-body">
        <div className="tl-title">
          {step.type}
          {step.status === 'skipped' && (
            <span className="faint" style={{ fontWeight: 400 }}> · skipped</span>
          )}
          {step.status === 'failed' && (
            <span style={{ color: 'var(--danger)', fontWeight: 400 }}> · failed</span>
          )}
        </div>
        <StepDetail step={step} />
        {replay && (
          <a className="replay-link" href={replay} target="_blank" rel="noreferrer">
            <IconArrow size={12} /> View agent replay
          </a>
        )}
      </div>
      <div className="feed-time">
        {step.finished_at && step.started_at
          ? `${durationMs(step.started_at, step.finished_at)}`
          : ''}
      </div>
    </div>
  )
}

function StepDetail({ step }: { step: RunStep }) {
  const out = (step.output ?? {}) as Record<string, unknown>
  if (step.status === 'pending') return <div className="tl-sub">waiting…</div>
  if (out.error) return <div className="tl-sub" style={{ color: 'var(--danger)' }}>{String(out.error)}</div>

  if (step.type === 'h_agent') {
    // The agent's actual answer is the most useful thing to show.
    if (out.answer) {
      return (
        <div className="tl-sub">
          <span className="faint">{String(out.backend ?? 'agent')} · </span>
          {String(out.answer)}
        </div>
      )
    }
    const bits: string[] = []
    if (out.backend) bits.push(String(out.backend))
    if (out.task) bits.push(String(out.task))
    if (out.status || out.state) bits.push(`status ${out.status ?? out.state}`)
    if (out.summary) return <div className="tl-sub">{String(out.summary)}</div>
    return <div className="tl-sub">{bits.join(' · ') || 'agent run'}</div>
  }
  if (step.type === 'composio') {
    const stub = out.stubbed ? ' (stubbed)' : ''
    return <div className="tl-sub">{String(out.action ?? 'composio')}{stub}</div>
  }
  if (step.type === 'condition') {
    return (
      <div className="tl-sub">
        {out.expression ? String(out.expression) : 'condition'}
        {out.passed === false ? ' → false (stopped)' : out.passed === true ? ' → true' : ''}
      </div>
    )
  }
  if (step.type === 'voice') {
    return <div className="tl-sub">{out.text ? String(out.text) : 'voice'}</div>
  }
  return null
}

function durationMs(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
