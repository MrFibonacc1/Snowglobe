import { useEffect, useRef, useState } from 'react'
import type { EventType } from '../types'
import { SUGGESTED_EVENT_TYPES, eventMeta } from '../constants'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { PillToggle } from './Cameras'
import { ConfidenceBar, EventIcon } from '../components/ui-kit'
import { Upload, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const PERCEPTION_URL =
  (import.meta.env.VITE_PERCEPTION_URL as string | undefined) ?? 'http://localhost:8008'

interface Verdict {
  event_type: EventType
  detected?: boolean
  confidence?: number
  count?: number | null
  detail?: string | null
  elapsed_ms?: number
  error?: string
}
interface FrameResult {
  index: number
  t_sec: number
  thumb: string
  verdicts: Verdict[]
}
interface SummaryRow {
  event_type: EventType
  fired: boolean
  frames_detected: number
  frames_total: number
  peak_confidence: number
  count: number | null
}
interface DetectResult {
  kind?: 'image' | 'video'
  model: string
  mock: boolean
  mode?: string
  verdicts?: Verdict[] // image
  frames?: FrameResult[] // video
  summary?: SummaryRow[] // video
  frames_analyzed?: number
  events: Record<string, unknown>[]
}

export function Testing() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [discover, setDiscover] = useState(true)
  const [selected, setSelected] = useState<EventType[]>([...SUGGESTED_EVENT_TYPES])
  const [customType, setCustomType] = useState('')
  const [zone, setZone] = useState('zone_a')
  const [minConf, setMinConf] = useState(0.5)
  const [maxFrames, setMaxFrames] = useState(6)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DetectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (f: File | null | undefined) => {
    if (!f) return
    const image = f.type.startsWith('image/')
    const video = f.type.startsWith('video/')
    if (!image && !video) {
      setError('Please choose an image or video file.')
      return
    }
    setError(null)
    setResult(null)
    setIsVideo(video)
    setFile(f)
  }

  const toggleEvent = (t: EventType) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))

  const addCustom = () => {
    const slug = customType
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (slug && !selected.includes(slug)) setSelected((s) => [...s, slug])
    setCustomType('')
  }

  const canRun = !!file && (discover || selected.length > 0)

  async function run() {
    if (!canRun) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file as File)
      // Empty `events` → open-ended discovery on the server.
      fd.append('events', discover ? '' : selected.join(','))
      fd.append('zone', zone)
      fd.append('min_confidence', String(minConf))
      const endpoint = isVideo ? '/detect_video' : '/detect'
      if (isVideo) fd.append('max_frames', String(maxFrames))
      const res = await fetch(`${PERCEPTION_URL}${endpoint}`, { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`detect API returned ${res.status}: ${body.slice(0, 200)}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(
        `Could not reach the perception detect API at ${PERCEPTION_URL}. ` +
          `Start it (from the repo root) with:  python -m perception.server` +
          `\n(${e instanceof Error ? e.message : String(e)})`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left: upload + controls */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div
            className={cn(
              'flex min-h-52 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40',
            )}
            onClick={() => !preview && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files?.[0])
            }}
          >
            {preview && isVideo ? (
              <video src={preview} controls className="max-h-72 w-full object-contain" />
            ) : preview ? (
              <img src={preview} alt="upload preview" className="max-h-72 w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <Upload className="size-7" />
                <div>
                  <b className="text-foreground">Click to upload</b> or drag an image or video here
                </div>
                <span className="text-xs">PNG / JPG / MP4, a photo, a frame, or a short clip</span>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          {file && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{file.name}</span>
              <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
                Replace
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <Label>Discovery mode</Label>
                <span className="text-xs text-muted-foreground">
                  Let the model surface and name any actionable event itself.
                </span>
              </div>
              <Switch checked={discover} onCheckedChange={setDiscover} aria-label="Discovery mode" />
            </div>

            {!discover && (
              <div className="flex flex-col gap-2">
                <Label>Watch for specific events</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set([...SUGGESTED_EVENT_TYPES, ...selected])].map((t) => (
                    <PillToggle
                      key={t}
                      selected={selected.includes(t)}
                      onClick={() => toggleEvent(t)}
                    >
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
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Zone</Label>
              <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone_a" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Min confidence, {Math.round(minConf * 100)}%</Label>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[minConf]}
                onValueChange={([v]) => setMinConf(v)}
                className="mt-2.5"
              />
            </div>
          </div>

          {isVideo && (
            <div className="flex flex-col gap-2">
              <Label>Frames to sample, {maxFrames}</Label>
              <Slider
                min={2}
                max={12}
                step={1}
                value={[maxFrames]}
                onValueChange={([v]) => setMaxFrames(v)}
                className="mt-2.5"
              />
              <span className="text-xs text-muted-foreground">
                {discover
                  ? `Each frame is examined for any actionable event. ${maxFrames} frames.`
                  : `Each frame runs every selected event type through the model, more frames = slower. ${maxFrames} frames x ${selected.length} type${selected.length === 1 ? '' : 's'}.`}
              </span>
            </div>
          )}

          <Button variant="olive" disabled={!canRun || busy} onClick={run}>
            {busy ? 'Running detection…' : discover ? 'Discover events' : 'Run detection'}
          </Button>
        </CardContent>
      </Card>

      {/* Right: results */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Results</CardTitle>
          {result && <Badge variant="secondary">{result.mock ? 'mock' : result.model}</Badge>}
        </CardHeader>
        <CardContent>
          {error && (
            <div className="whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {!error && !result && !busy && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Upload an image or video and run detection to see per-event verdicts and the events
              that would fire.
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />{' '}
              {isVideo ? 'sampling frames and calling the model…' : 'calling the vision model…'}
            </div>
          )}

          {result && result.kind === 'video' && <VideoResults r={result} minConf={minConf} />}

          {result && result.kind !== 'video' && (
            <div className="flex flex-col gap-5">
              {(result.verdicts ?? []).length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {result.mode === 'targeted'
                    ? 'None of the selected events were detected.'
                    : 'No actionable events found in this frame.'}
                </div>
              )}
              <div className="flex flex-col divide-y divide-border/60">
                {(result.verdicts ?? []).map((v) => {
                  const m = eventMeta(v.event_type)
                  const fired = v.detected && (v.confidence ?? 0) >= minConf && !v.error
                  return (
                    <div key={v.event_type} className="flex items-start gap-3 py-3 first:pt-0">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted" style={{ color: m?.color }}>
                        <EventIcon type={v.event_type} className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {m?.label ?? v.event_type}
                          {v.error ? (
                            <span className="text-xs font-normal text-destructive">error</span>
                          ) : fired ? (
                            <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-500">
                              <Check className="size-3" /> fires event
                            </span>
                          ) : v.detected ? (
                            <span className="text-xs font-normal text-muted-foreground">
                              below threshold
                            </span>
                          ) : (
                            <span className="text-xs font-normal text-muted-foreground">
                              not detected
                            </span>
                          )}
                        </div>
                        {v.error ? (
                          <div className="text-xs text-destructive">{v.error}</div>
                        ) : (
                          <>
                            <ConfidenceBar
                              value={v.confidence ?? 0}
                              color={m?.color}
                              className="my-1.5"
                            />
                            <div className="text-xs text-muted-foreground">
                              {Math.round((v.confidence ?? 0) * 100)}% confidence
                              {typeof v.count === 'number' && ` · count ${v.count}`}
                              {v.detail && ` · ${v.detail}`}
                              {typeof v.elapsed_ms === 'number' && ` · ${v.elapsed_ms}ms`}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <EventsBlock events={result.events} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function EventsBlock({ events }: { events: Record<string, unknown>[] }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold">Events emitted ({events.length})</div>
      {events.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          Nothing crossed the confidence threshold. No events would fire.
        </div>
      ) : (
        <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">
          {JSON.stringify(events, null, 2)}
        </pre>
      )}
    </div>
  )
}

function VideoResults({ r, minConf }: { r: DetectResult; minConf: number }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col divide-y divide-border/60">
        {(r.summary ?? []).map((s) => {
          const m = eventMeta(s.event_type)
          return (
            <div key={s.event_type} className="flex items-start gap-3 py-3 first:pt-0">
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"
                style={{ color: m.color }}
              >
                <EventIcon type={s.event_type} className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {m.label}
                  {s.fired ? (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-500">
                      <Check className="size-3" /> fires event
                    </span>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">not detected</span>
                  )}
                </div>
                <ConfidenceBar value={s.peak_confidence} color={m.color} className="my-1.5" />
                <div className="text-xs text-muted-foreground">
                  peak {Math.round(s.peak_confidence * 100)}% · detected in {s.frames_detected}/
                  {s.frames_total} frames
                  {typeof s.count === 'number' && ` · count ${s.count}`}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Timeline ({r.frames_analyzed} frames)</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(r.frames ?? []).map((f) => {
            const fired = f.verdicts.filter(
              (v) => v.detected && (v.confidence ?? 0) >= minConf,
            )
            return (
              <div key={f.index} className="w-24 shrink-0">
                <img
                  src={f.thumb}
                  alt={`frame ${f.index}`}
                  className="h-16 w-full rounded-md border object-cover"
                />
                <div className="mt-1 text-center text-xs text-muted-foreground tabular-nums">
                  {f.t_sec}s
                </div>
                <div className="flex flex-wrap justify-center gap-1">
                  {fired.length === 0 ? (
                    <span className="text-xs text-muted-foreground">&mdash;</span>
                  ) : (
                    fired.map((v) => (
                      <EventIcon
                        key={v.event_type}
                        type={v.event_type}
                        className="size-3"
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <EventsBlock events={r.events} />
    </div>
  )
}
