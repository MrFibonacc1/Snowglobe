import type { Store } from '../store'
import type { Run, RunStep } from '../types'
import { eventMeta } from '../constants'
import { timeAgo } from '../util'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusDot, EventIcon, GroundingBadge } from '../components/ui-kit'
import { cn } from '@/lib/utils'
import { Check, Loader2, ExternalLink } from 'lucide-react'

export function Runs({ store }: { store: Store }) {
  const runs = store.runs

  return (
    <div className="flex flex-col gap-6">
      {store.backendOnline === false && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          Automation backend unreachable. No live runs. Start it with{' '}
          <code className="rounded bg-background/50 px-1">uvicorn main:app --port 8000</code>, then
          Go live.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">Runs</h2>
          <span className="text-sm text-muted-foreground">{runs.length} recent</span>
        </div>
        <Badge variant="secondary" className="gap-1.5">
          <StatusDot status={store.live ? 'live' : 'offline'} />
          {store.live ? 'polling /runs' : 'paused, Go live'}
        </Badge>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No runs yet. Go live and trigger a workflow (or use its <b>Test</b> button) to watch steps
          execute here in real time.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}

function RunCard({ run }: { run: Run }) {
  const m = eventMeta(run.event.event_type)
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" style={{ color: m?.color }}>
              <EventIcon type={run.event.event_type} className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">{run.workflow_name ?? run.workflow_id}</div>
              <div className="text-xs text-muted-foreground">
                {m?.label ?? run.event.event_type} in {run.event.location} ·{' '}
                {Math.round(run.event.confidence * 100)}%
              </div>
              <div className="mt-1">
                <GroundingBadge payload={run.event.payload} />
              </div>
            </div>
          </div>
          <RunStatusBadge status={run.status} />
        </div>

        <div className="flex flex-col gap-0">
          {run.steps.map((step, i) => (
            <StepRow key={step.id} step={step} last={i === run.steps.length - 1} />
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{run.started_at ? timeAgo(run.started_at) : ''}</span>
          <span className="font-mono opacity-60">{run.id}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'border-primary/40 text-primary',
    done: 'border-emerald-500/40 text-emerald-500',
    failed: 'border-destructive/40 text-destructive',
  }
  return (
    <Badge variant="outline" className={cn('capitalize', map[status])}>
      {status}
    </Badge>
  )
}

function StepRow({ step, last }: { step: RunStep; last: boolean }) {
  const out = step.output ?? {}
  const replay = (out.agent_view_url as string) || (out.replay_url as string) || null
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepMarker status={step.status} />
        {!last && <span className="w-px flex-1 bg-border" />}
      </div>
      <div className="flex-1 pb-4">
        <div className="text-sm font-medium">
          {step.type}
          {step.status === 'skipped' && (
            <span className="font-normal text-muted-foreground"> · skipped</span>
          )}
          {step.status === 'failed' && (
            <span className="font-normal text-destructive"> · failed</span>
          )}
        </div>
        <StepDetail step={step} />
        {replay && (
          <a
            className="mt-1 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={replay}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="size-3" /> View agent replay
          </a>
        )}
      </div>
      <div className="pt-0.5 text-xs text-muted-foreground">
        {step.finished_at && step.started_at
          ? durationMs(step.started_at, step.finished_at)
          : ''}
      </div>
    </div>
  )
}

function StepMarker({ status }: { status: string }) {
  if (status === 'running')
    return (
      <span className="flex size-5 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-primary" />
      </span>
    )
  if (status === 'done')
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <Check className="size-3" />
      </span>
    )
  const color =
    status === 'failed' ? 'bg-destructive' : status === 'skipped' ? 'bg-muted-foreground/40' : 'bg-muted-foreground/60'
  return (
    <span className="flex size-5 items-center justify-center">
      <span className={cn('size-2 rounded-full', color)} />
    </span>
  )
}

function StepDetail({ step }: { step: RunStep }) {
  const out = (step.output ?? {}) as Record<string, unknown>
  if (step.status === 'pending')
    return <div className="text-xs text-muted-foreground">waiting…</div>
  if (out.error) {
    const diagnostics = []
    if (out.backend) diagnostics.push(String(out.backend))
    if (out.status || out.state) diagnostics.push(`status ${String(out.status ?? out.state)}`)
    if (out.steps !== undefined) diagnostics.push(`${String(out.steps)} steps`)
    if (out.duration_sec !== undefined) diagnostics.push(`${String(out.duration_sec)}s`)
    return (
      <div className="text-xs text-destructive">
        <div>{String(out.error)}</div>
        {diagnostics.length > 0 && <div className="mt-0.5 opacity-70">{diagnostics.join(' · ')}</div>}
      </div>
    )
  }

  if (step.type === 'h_agent') {
    // The agent's actual answer is the most useful thing to show.
    if (out.answer) {
      return (
        <div className="text-xs text-muted-foreground">
          <span className="opacity-70">{String(out.backend ?? 'agent')} · </span>
          {String(out.answer)}
        </div>
      )
    }
    const bits: string[] = []
    if (out.backend) bits.push(String(out.backend))
    if (out.task) bits.push(String(out.task))
    if (out.status || out.state) bits.push(`status ${out.status ?? out.state}`)
    if (out.summary) return <div className="text-xs text-muted-foreground">{String(out.summary)}</div>
    return <div className="text-xs text-muted-foreground">{bits.join(' · ') || 'agent run'}</div>
  }
  if (step.type === 'composio') {
    return (
      <div className="text-xs text-muted-foreground">
        {out.executed === true
          ? `${String(out.action ?? 'composio')} · external action confirmed`
          : `${String(out.action ?? 'composio')} · execution not confirmed`}
      </div>
    )
  }
  if (step.type === 'condition') {
    return (
      <div className="text-xs text-muted-foreground">
        {out.expression ? String(out.expression) : 'condition'}
        {out.passed === false ? ' → false (stopped)' : out.passed === true ? ' → true' : ''}
      </div>
    )
  }
  if (step.type === 'voice') {
    const audioUrl = out.audio_url as string | undefined
    const stub = out.stubbed ? (out.unavailable ? ' (unavailable)' : ' (stubbed)') : ''
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-muted-foreground">
          <span className="opacity-70">spoke · </span>
          {out.text ? String(out.text) : 'voice'}
          {stub}
          {out.played ? <span className="opacity-70"> · played aloud</span> : ''}
        </div>
        {audioUrl && (
          <audio controls preload="none" src={audioUrl} className="h-8 w-full max-w-xs">
            <a href={audioUrl} target="_blank" rel="noreferrer">
              Play spoken alert
            </a>
          </audio>
        )}
      </div>
    )
  }
  if (step.type === 'mcp') {
    return (
      <div className="text-xs text-muted-foreground">
        <span className="opacity-70">{String(out.tool ?? 'mcp')} · </span>
        {String(out.result ?? '')}
      </div>
    )
  }
  if (step.type === 'inventory_adjust') {
    return (
      <div className="text-xs text-muted-foreground">
        {String(out.sku ?? 'inventory')} · {String(out.before ?? '?')} → {String(out.after ?? '?')}
        {out.applied === false ? ' · duplicate event ignored' : ''}
      </div>
    )
  }
  return null
}

function durationMs(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
