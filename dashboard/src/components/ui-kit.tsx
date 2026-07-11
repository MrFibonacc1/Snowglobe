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
      : status === 'connecting'
        ? 'bg-amber-500'
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
