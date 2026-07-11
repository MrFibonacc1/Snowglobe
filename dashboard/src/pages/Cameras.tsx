import { useState } from 'react'
import type { Store } from '../store'
import type { Camera, CameraSource, EventType } from '../types'
import { SUGGESTED_EVENT_TYPES, eventMeta, SOURCE_LABEL } from '../constants'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusDot, EventIcon } from '../components/ui-kit'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Camera as CameraIcon } from 'lucide-react'

const SOURCES: { id: CameraSource; d: string }[] = [
  { id: 'webcam', d: 'This machine' },
  { id: 'rtsp', d: 'rtsp:// URL' },
  { id: 'hls', d: '.m3u8 stream' },
  { id: 'file', d: 'Uploaded clip' },
]

export function Cameras({ store }: { store: Store }) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">Cameras</h2>
          <span className="text-sm text-muted-foreground">{store.cameras.length} connected</span>
        </div>
        <Button onClick={() => setAdding(true)} className="gap-1.5">
          <Plus className="size-4" /> Connect camera
        </Button>
      </div>

      {store.cameras.length === 0 ? (
        <EmptyState>
          No cameras yet. Connect a webcam, RTSP feed, or clip to start producing events.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {store.cameras.map((cam) => (
            <CameraCard key={cam.id} cam={cam} store={store} />
          ))}
        </div>
      )}

      {adding && (
        <AddCameraDialog
          onClose={() => setAdding(false)}
          onAdd={(c) => {
            store.addCamera(c)
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function CameraCard({ cam, store }: { cam: Camera; store: Store }) {
  const [snapBroken, setSnapBroken] = useState(false)
  // Latest event from this camera's zone that carries a frame — the closest
  // thing to a live preview without streaming video into the browser.
  const snap = store.events.find(
    (e) => e.location === cam.zone && e.snapshot_url,
  )?.snapshot_url

  return (
    <Card className="overflow-hidden pt-0">
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br from-muted to-background text-muted-foreground">
        {snap && !snapBroken && (
          <img
            src={snap}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setSnapBroken(true)}
          />
        )}
        {cam.status === 'live' && (
          <div className="absolute inset-x-0 top-0 h-full w-full animate-pulse bg-[linear-gradient(transparent,transparent_50%,rgba(255,255,255,0.03)_50%)] bg-[length:100%_8px]" />
        )}
        <div className="absolute left-3 top-3">
          <Badge variant="secondary" className="gap-1.5 capitalize">
            <StatusDot status={cam.status} />
            {cam.status}
          </Badge>
        </div>
        {(!snap || snapBroken) && <CameraIcon className="size-8 opacity-40" />}
        <div className="absolute bottom-3 right-3 rounded bg-background/70 px-1.5 py-0.5 text-xs tabular-nums">
          {cam.fps} fps
        </div>
      </div>
      <CardContent className="flex flex-col gap-3">
        <h3 className="font-semibold">{cam.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{cam.zone}</Badge>
          <Badge variant="outline">{SOURCE_LABEL[cam.source]}</Badge>
          <Badge variant="outline">{cam.eventsToday} events today</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cam.detects.length === 0 && (
            <Badge variant="secondary" className="gap-1">
              <EventIcon type="*" className="size-3" /> Discover events
            </Badge>
          )}
          {cam.detects.map((d) => (
            <Badge
              key={d}
              variant="outline"
              className="gap-1"
              style={{ color: eventMeta(d).color, borderColor: `${eventMeta(d).color}40` }}
            >
              <EventIcon type={d} className="size-3" /> {eventMeta(d).label}
            </Badge>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => store.toggleCamera(cam.id)}>
            {cam.status === 'live' ? 'Pause' : 'Resume'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto text-muted-foreground hover:text-destructive"
            onClick={() => store.removeCamera(cam.id)}
            aria-label="Remove camera"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AddCameraDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (c: Omit<Camera, 'id' | 'eventsToday'>) => void
}) {
  const [name, setName] = useState('')
  const [zone, setZone] = useState('zone_a')
  const [source, setSource] = useState<CameraSource>('rtsp')
  const [url, setUrl] = useState('')
  const [detects, setDetects] = useState<EventType[]>([])
  const [customType, setCustomType] = useState('')

  const needsUrl = source === 'rtsp' || source === 'hls'
  const valid = name.trim() && zone.trim() && (!needsUrl || url.trim())

  const toggle = (t: EventType) =>
    setDetects((d) => (d.includes(t) ? d.filter((x) => x !== t) : [...d, t]))

  const addCustom = () => {
    const slug = customType
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (slug && !detects.includes(slug)) setDetects((d) => [...d, slug])
    setCustomType('')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a camera</DialogTitle>
          <DialogDescription>
            Add a video source. Detections stream into the event feed at the sampled frame rate.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label>Source type</Label>
            <div className="grid grid-cols-2 gap-2">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    source === s.id
                      ? 'border-primary bg-primary/10'
                      : 'hover:bg-accent',
                  )}
                  onClick={() => setSource(s.id)}
                >
                  <div className="text-sm font-medium">{SOURCE_LABEL[s.id]}</div>
                  <div className="text-xs text-muted-foreground">{s.d}</div>
                </button>
              ))}
            </div>
          </div>

          <Field label="Camera name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Loading Bay East"
              autoFocus
            />
          </Field>

          {needsUrl && (
            <Field
              label="Stream URL"
              hint="Perception samples this feed at 1 fps and sends frames to the Cosmos 3 Reasoner."
            >
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={source === 'rtsp' ? 'rtsp://10.0.0.20/stream1' : 'https://…/index.m3u8'}
              />
            </Field>
          )}

          <Field label="Zone" hint="Used to route events to zone-scoped automations.">
            <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone_a" />
          </Field>

          <div className="flex flex-col gap-2">
            <Label>Watch for specific events (optional)</Label>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...SUGGESTED_EVENT_TYPES, ...detects])].map((t) => (
                <PillToggle key={t} selected={detects.includes(t)} onClick={() => toggle(t)}>
                  <EventIcon type={t} className="size-3.5" /> {eventMeta(t).label}
                </PillToggle>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustom()
                  }
                }}
                placeholder="add a custom event, e.g. blocked_exit"
              />
              <Button type="button" variant="secondary" onClick={addCustom}>
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave empty for open-ended discovery — the perception model
              surfaces and names any actionable event on its own.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              valid &&
              onAdd({
                name: name.trim(),
                zone: zone.trim(),
                source,
                url: needsUrl ? url.trim() : undefined,
                status: 'connecting',
                fps: 1,
                detects,
              })
            }
          >
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function PillToggle({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-none border px-3 py-1 text-xs font-medium transition-colors',
        selected
          ? 'border-primary bg-primary/15 text-foreground'
          : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

// re-export Slider for pages that want the shared field styling
export { Slider }
