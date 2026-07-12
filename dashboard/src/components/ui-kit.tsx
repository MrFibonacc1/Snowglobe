import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { eventMeta } from '@/constants'
import type { EventType } from '@/types'

/** Colored dot for live/offline/connecting/status states. */
export function StatusDot({
  status,
  className,
}: {
  status: 'live' | 'offline' | 'connecting' | 'connected' | 'disconnected' | string
  className?: string
}) {
  const color =
    status === 'live' || status === 'connected'
      ? 'bg-emerald-500'
      : status === 'connecting' || status === 'paused'
        ? 'bg-amber-500'
        : status === 'error'
          ? 'bg-red-500'
          : 'bg-muted-foreground/50'
  const pulse = status === 'live' || status === 'connecting'
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            color,
          )}
        />
      )}
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  )
}

/** Renders the lucide icon associated with an event type. */
export function EventIcon({
  type,
  className,
}: {
  type: EventType
  className?: string
}) {
  const Icon = eventMeta(type).icon
  return <Icon className={className} />
}

/** Event-type pill with its icon + brand color. */
export function EventBadge({
  type,
  className,
}: {
  type: EventType
  className?: string
}) {
  const m = eventMeta(type)
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium', className)}
      style={{ color: m.color, borderColor: `${m.color}40` }}
    >
      <EventIcon type={type} className="size-3.5" />
      {m.label}
    </Badge>
  )
}

/** Horizontal confidence bar (0..1) tinted by the event color. */
export function ConfidenceBar({
  value,
  color,
  className,
}: {
  value: number
  color?: string
  className?: string
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: color ?? 'var(--primary)' }}
      />
    </div>
  )
}

type GroundedObject = { phrase?: string; confidence?: number }

/**
 * Honest confidence breakdown. The top-level `confidence` on an event is a
 * *fused* number (the VLM's self-report, adjusted by an independent object
 * detector). A bare percentage hides which signal it came from, so here we
 * separate them: what the vision-language model claimed, and whether a second
 * model (YOLO) actually saw the objects that would corroborate it.
 *
 * Reads perception's payload fields: `vlm_confidence`, `grounded`,
 * `grounding_confidence`, `objects`. Degrades gracefully — if grounding never
 * ran (older events, mock mode), it just shows the model's confidence.
 */
export function GroundingBadge({
  payload,
  confidence,
  className,
}: {
  payload?: Record<string, unknown> | null
  // The fused/effective event confidence. When given, the badge shows how the
  // model's raw read became the final number instead of leaving two
  // disconnected percentages elsewhere in the UI.
  confidence?: number
  className?: string
}) {
  const p = payload ?? {}
  const grounded = p.grounded as boolean | undefined
  const vlmConf = typeof p.vlm_confidence === 'number' ? (p.vlm_confidence as number) : undefined
  const objects = Array.isArray(p.objects) ? (p.objects as GroundedObject[]) : []

  const vlmPct = vlmConf !== undefined ? `${Math.round(vlmConf * 100)}%` : null
  const fusedPct = confidence !== undefined ? `${Math.round(confidence * 100)}%` : null

  // Nothing to say: no grounding signal and no fused confidence to fall back on.
  if (grounded === undefined && vlmConf === undefined && fusedPct === null) return null

  const objNames = objects
    .map((o) => o.phrase)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')

  // Detector didn't corroborate AND we know the fused result → tell the whole
  // story in one badge ("VLM 90% → 54%") rather than showing 90% and 54% as two
  // numbers that look like they contradict each other.
  if (grounded === false && vlmPct && fusedPct) {
    return (
      <Badge
        variant="outline"
        title={`The vision model was ${vlmPct} confident, but the object detector didn't corroborate it, so the effective confidence is ${fusedPct}.`}
        className={cn('gap-1 font-normal bg-amber-500/10 border-amber-500/40 text-amber-600', className)}
      >
        <span className="opacity-80">VLM {vlmPct}</span>
        <span className="opacity-60">→</span>
        <span className="font-medium">{fusedPct}</span>
        <span className="opacity-70">unconfirmed</span>
      </Badge>
    )
  }

  let toneClass: string
  let label: string
  if (grounded === true) {
    toneClass = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600'
    label = objNames ? `confirmed · ${objNames}` : 'confirmed by detector'
  } else if (grounded === false) {
    toneClass = 'bg-amber-500/10 border-amber-500/40 text-amber-600'
    label = 'unconfirmed by detector'
  } else {
    // No grounding ran (mock / older events): just show the confidence plainly.
    toneClass = 'bg-muted border-muted text-muted-foreground'
    label = 'confidence'
  }

  const lead = vlmPct ? `VLM ${vlmPct}` : fusedPct
  return (
    <Badge variant="outline" className={cn('gap-1 font-normal', toneClass, className)}>
      {lead && <span className="opacity-80">{lead}</span>}
      {lead && <span className="opacity-40">·</span>}
      <span>{label}</span>
    </Badge>
  )
}
