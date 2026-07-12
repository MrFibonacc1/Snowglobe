import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentFeed, AgentStep, Run } from '../types'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Check,
  Loader2,
  ExternalLink,
  MousePointer2,
  Globe,
  Keyboard,
  Flag,
  Bot,
} from 'lucide-react'

// Watch the H agent's *actual movements* live — a Claude-cowork style view.
// The automation service proxies H's per-session event stream (screenshots +
// the agent's reasoning + each tool call) at /agent/sessions/{id}/events, and
// re-serves the authed screenshots at /agent/screenshot. We poll that here and
// render the latest screen (with the agent's cursor) plus a running action log.
//
// `sessionId` comes from the h_agent step output (published mid-run via the
// engine's progress callback). `viewUrl` is H's own session page — we still
// link out to it since H blocks iframe embedding, but the screenshot feed means
// you can watch the agent right here without leaving the dashboard.
export function LiveAgentViewer({
  sessionId,
  running,
  viewUrl,
  className,
}: {
  sessionId: string
  running: boolean
  viewUrl?: string | null
  className?: string
}) {
  const [feed, setFeed] = useState<AgentFeed | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId || !api.configured()) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    const maxMs = 300_000 // ~5 min guardrail

    const tick = async () => {
      try {
        const next = await api.agentFeed(sessionId)
        if (cancelled) return
        setFeed(next)
        setError(null)
        const done = next.status !== 'running' || !running
        // Keep polling while running (screens change each step). Once the run
        // stops we do one final fetch and then hold the last frame.
        if (!done && Date.now() - startedAt < maxMs) {
          timer = setTimeout(tick, 2000)
        }
      } catch (e) {
        if (cancelled) return
        // H exposes the events endpoint a beat after the session is created;
        // keep retrying quietly rather than showing an error immediately.
        if (Date.now() - startedAt < maxMs) {
          timer = setTimeout(tick, 2500)
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, running])

  const steps = feed?.steps ?? []
  const shot = feed?.latest_screenshot ? api.agentScreenshotUrl(feed.latest_screenshot) : null

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* The agent's screen */}
      <AgentScreen
        screenshot={shot}
        cursor={feed?.cursor ?? null}
        viewport={feed?.viewport ?? null}
        url={feed?.url ?? null}
        running={running && feed?.status === 'running'}
        hasSteps={steps.length > 0}
      />

      {/* Action log — the agent's movements, newest last so it reads like a story */}
      <div className="flex flex-col gap-1.5">
        {steps.length === 0 && !error && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Waiting for the agent's first move…
          </div>
        )}
        {steps.map((s, i) => (
          <ActionRow key={s.index} step={s} last={i === steps.length - 1} running={running} />
        ))}
        {error && (
          <div className="text-xs text-muted-foreground">
            Live view unavailable ({error}).
          </div>
        )}
      </div>

      {viewUrl && (
        <a
          href={viewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3.5" /> Open the full session on H
        </a>
      )}
    </div>
  )
}

function AgentScreen({
  screenshot,
  cursor,
  viewport,
  url,
  running,
  hasSteps,
}: {
  screenshot: string | null
  cursor: [number, number] | null
  viewport: [number, number] | null
  url: string | null
  running: boolean
  hasSteps: boolean
}) {
  // Cursor position is in viewport pixels; convert to a percentage so it lands
  // correctly regardless of how the screenshot is scaled in the box.
  const cursorPct = useMemo(() => {
    if (!cursor || !viewport || !viewport[0] || !viewport[1]) return null
    return {
      left: `${(cursor[0] / viewport[0]) * 100}%`,
      top: `${(cursor[1] / viewport[1]) * 100}%`,
    }
  }, [cursor, viewport])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40">
      {/* Fake browser chrome so the screen reads as "the agent's browser" */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-background/80 px-3 py-1.5 backdrop-blur">
        <span className="flex gap-1">
          <span className="size-2 rounded-full bg-red-400/70" />
          <span className="size-2 rounded-full bg-amber-400/70" />
          <span className="size-2 rounded-full bg-emerald-400/70" />
        </span>
        <span className="truncate text-xs text-muted-foreground">{url || 'about:blank'}</span>
        {running && (
          <Badge variant="secondary" className="ml-auto gap-1 text-[10px]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            live
          </Badge>
        )}
      </div>

      {screenshot ? (
        <>
          <img
            src={screenshot}
            alt="agent screen"
            className="absolute inset-0 mt-7 h-[calc(100%-1.75rem)] w-full object-contain"
          />
          {cursorPct && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: cursorPct.left, top: cursorPct.top }}
            >
              <span className="absolute -inset-2 animate-ping rounded-full bg-primary/30" />
              <MousePointer2 className="relative size-5 fill-primary text-primary drop-shadow" />
            </div>
          )}
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Bot className="size-8 opacity-40" />
          {hasSteps ? 'Loading the agent screen…' : 'Spinning up the agent browser…'}
        </div>
      )}
    </div>
  )
}

function actionIcon(step: AgentStep) {
  if (step.kind === 'answer') return Flag
  const t = step.title.toLowerCase()
  if (t.startsWith('navigate')) return Globe
  if (t.startsWith('type')) return Keyboard
  if (t.startsWith('click')) return MousePointer2
  return Bot
}

function ActionRow({
  step,
  last,
  running,
}: {
  step: AgentStep
  last: boolean
  running: boolean
}) {
  const Icon = actionIcon(step)
  const active = last && running && step.kind !== 'answer'
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {active ? (
          <Loader2 className="size-3.5 animate-spin text-primary" />
        ) : step.kind === 'answer' ? (
          <Check className="size-3.5 text-emerald-500" />
        ) : (
          <Icon className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn('font-medium', active && 'text-primary')}>{step.title}</span>
        {step.detail && (
          <div className="line-clamp-2 text-muted-foreground">{step.detail}</div>
        )}
      </div>
    </div>
  )
}

// Given a run, pull the H session id + view url from any h_agent step output.
export function agentSessionFromRun(run: Run): { sessionId?: string; viewUrl?: string } {
  let sessionId: string | undefined
  let viewUrl: string | undefined
  for (const s of run.steps) {
    const out = s.output ?? {}
    if (!sessionId && typeof out.session_id === 'string') sessionId = out.session_id
    if (!viewUrl && typeof out.agent_view_url === 'string') viewUrl = out.agent_view_url
    if (!viewUrl && typeof out.replay_url === 'string') viewUrl = out.replay_url as string
  }
  return { sessionId, viewUrl }
}
