import { useState } from 'react'
import { toast } from 'sonner'
import type { AppEvent } from '../types'
import type { Store } from '../store'
import { api } from '../api'
import { SUGGESTED_EVENT_TYPES, eventMeta } from '../constants'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { EventIcon } from '../components/ui-kit'
import { Send, Zap } from 'lucide-react'

const COUNT_LIKE = /count|traffic|crowd|queue|occupancy|people/i

function uid() {
  return `evt_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

async function emit(event: AppEvent): Promise<number | null> {
  try {
    const res = await api.postEvent(event)
    return res.runs_started?.length ?? 0
  } catch {
    return null
  }
}

export function ManualEvents({ store }: { store: Store }) {
  const online = store.backendOnline !== false
  const [type, setType] = useState('spill')
  const [zone, setZone] = useState('zone_a')
  const [count, setCount] = useState('')
  const [detail, setDetail] = useState('')
  const [confidence, setConfidence] = useState(0.9)
  const [busy, setBusy] = useState(false)

  const report = (n: number | null, label: string) => {
    if (n === null) toast.error('Backend offline — event not sent')
    else if (n > 0)
      toast.success(`Sent ${label} — triggered ${n} workflow${n === 1 ? '' : 's'}`, {
        description: 'Watch them on the Runs page.',
      })
    else toast.info(`Sent ${label} — no workflows matched`)
  }

  const quickSend = async (t: string) => {
    setBusy(true)
    const payload: Record<string, unknown> = COUNT_LIKE.test(t)
      ? { count: 25 }
      : { detail: `${eventMeta(t).label} detected (test)` }
    report(
      await emit({
        event_id: uid(),
        event_type: t,
        timestamp: new Date().toISOString(),
        confidence: 0.9,
        location: 'zone_a',
        payload,
      }),
      eventMeta(t).label,
    )
    setBusy(false)
  }

  const sendCustom = async () => {
    setBusy(true)
    const n = Number(count)
    const payload: Record<string, unknown> = {}
    if (count.trim() && !Number.isNaN(n)) payload.count = n
    if (detail.trim()) payload.detail = detail.trim()
    if (Object.keys(payload).length === 0) payload.detail = `${eventMeta(type).label} detected (test)`
    report(
      await emit({
        event_id: uid(),
        event_type: type.trim() || 'spill',
        timestamp: new Date().toISOString(),
        confidence,
        location: zone.trim() || 'zone_a',
        payload,
      }),
      eventMeta(type).label,
    )
    setBusy(false)
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Zap className="size-4 text-primary" /> Send test events
        </CardTitle>
        <Badge variant="secondary" className="gap-1.5">
          {online ? 'sends to backend → workflows fire' : 'backend offline'}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Quick send — one click per event type */}
        <div className="flex flex-col gap-2">
          <Label className="text-muted-foreground">Quick send</Label>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_EVENT_TYPES.map((t) => {
              const m = eventMeta(t)
              return (
                <Button
                  key={t}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy || !online}
                  onClick={() => quickSend(t)}
                  style={{ borderColor: `${m.color}40` }}
                >
                  <span style={{ color: m.color }} className="flex">
                    <EventIcon type={t} className="size-3.5" />
                  </span>
                  {m.label}
                </Button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Fires an event in zone_a at 90% confidence — every matching workflow runs.
          </p>
        </div>

        {/* Customize */}
        <div className="flex flex-col gap-3 rounded-lg border bg-card/50 p-3">
          <Label className="text-muted-foreground">Custom event</Label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Event type</Label>
              <Input
                value={type}
                onChange={(e) =>
                  setType(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
                }
                placeholder="spill, foot_traffic, …"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Zone</Label>
              <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone_a" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Count (optional)</Label>
              <Input
                type="number"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                placeholder="e.g. 25"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Detail (optional)</Label>
              <Input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="free-text detail"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Confidence, {Math.round(confidence * 100)}%</Label>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[confidence]}
              onValueChange={([v]) => setConfidence(v)}
            />
          </div>
          <div>
            <Button onClick={sendCustom} disabled={busy || !online} className="gap-1.5">
              <Send className="size-4" /> Send custom event
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
