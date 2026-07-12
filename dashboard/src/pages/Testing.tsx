import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppEvent, EventType } from '../types'
import type { Store } from '../store'
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
import { api } from '../api'

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
  events?: Record<string, unknown>[]
}

export function Testing({ store }: { store: Store }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [discover, setDiscover] = useState(true)
  const [selected, setSelected] = useState<EventType[]>([...SUGGESTED_EVENT_TYPES])
  const [customType, setCustomType] = useState('')
  const [zone, setZone] = useState('zone_a')
  const [minConf, setMinConf] = useState(0.5)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const file = store.testingFile
  const isVideo = file?.type.startsWith('video/') ?? false
  const busy = store.testingRun?.running ?? false
  const result = (store.testingResult as DetectResult | null) ?? null
  const error = store.testingError

  useEffect(() => {
    if (!file) {
      setPreview(null)
      setVideoDuration(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    if (!isVideo) setVideoDuration(null)
    return () => URL.revokeObjectURL(url)
  }, [file, isVideo])

  const pick = (f: File | null | undefined) => {
    if (!f) return
    const image = f.type.startsWith('image/')
    if (!image && !f.type.startsWith('video/')) {
      store.setTestingError('Please choose an image or video file.')
      return
    }
    store.setTestingError(null)
    store.setTestingResult(null)
    store.setTestingFile(f)
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

  const estimateVideoSampling = useCallback(() => {
    if (!isVideo || !videoDuration || !Number.isFinite(videoDuration)) {
      return { fps: 0.8, maxFrames: 8 }
    }
    const fps = videoDuration >= 180 ? 0.4 : videoDuration >= 60 ? 0.7 : 0.95
    const maxFrames = Math.min(20, Math.max(4, Math.round(videoDuration * fps)))
    return { fps: Number(fps.toFixed(2)), maxFrames }
  }, [isVideo, videoDuration])

  const canRun = !!file && (discover || selected.length > 0)
  const refreshRuns = useCallback(async () => {
    if (!api.configured()) return
    await store.refreshRuns()
    // Runs can be created async after workflow execution starts; poll once more.
    await new Promise((resolve) => setTimeout(resolve, 900))
    await store.refreshRuns()
    // and one more quick pass for slower agents.
    await new Promise((resolve) => setTimeout(resolve, 900))
    await store.refreshRuns()
  }, [store])

  const waitForRunCompletion = useCallback(
    async (runIds: string[]) => {
      if (!api.configured() || runIds.length === 0) return
      const target = new Set(runIds)
      const startedAt = Date.now()
      const timeoutMs = 12000
      const minPollMs = 700

      while (Date.now() - startedAt < timeoutMs) {
        const runs = await store.refreshRuns()
        const tracked = runs.filter((run) => target.has(run.id))

        // If we have at least one matched run and none are still running, we're done.
        if (tracked.length > 0 && !tracked.some((run) => run.status === 'running')) break

        if (!tracked.length) {
          // Even with a short window for async creation, the run may not have
          // been inserted yet. Poll a bit longer and keep trying.
          if (Date.now() - startedAt < timeoutMs - 3000) {
            await new Promise((resolve) => setTimeout(resolve, minPollMs))
            continue
          }
        }

        await new Promise((resolve) => setTimeout(resolve, minPollMs))
      }

      // Final authoritative refresh after the loop.
      await refreshRuns()
    },
    [refreshRuns, store],
  )
  async function run() {
    if (!canRun) return
    const mediaKind: 'image' | 'video' = isVideo ? 'video' : 'image'
    let runError: string | null = null
    store.startTestingRun({ kind: mediaKind, fileName: file?.name || 'upload' })
    store.setTestingError(null)
    store.setTestingResult(null)

    try {
      const fd = new FormData()
      fd.append('file', file as File)
      // Empty `events` → open-ended discovery on the server.
      fd.append('events', discover ? '' : selected.join(','))
      fd.append('zone', zone)
      fd.append('min_confidence', String(minConf))
      const endpoint = isVideo ? '/detect_video' : '/detect'
      if (isVideo) {
        const { fps, maxFrames } = estimateVideoSampling()
        fd.append('fps', String(fps))
        fd.append('max_frames', String(maxFrames))
      }
      const res = await fetch(`${PERCEPTION_URL}${endpoint}`, { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`detect API returned ${res.status}: ${body.slice(0, 200)}`)
      }
      const payload = (await res.json()) as DetectResult
      const events = parseResultEvents(payload.events ?? [])
      store.setTestingResult(payload)

      if (events.length) {
        // Persist testing detections into the UI event log immediately.
        store.ingestEvents(events)

        // Send to automation so workflow runs are created and reflected in Runs.
        let postError: string | null = null
        const runIds: string[] = []
        if (api.configured()) {
          const posts = events.map(async (event) =>
            api
              .postEvent(event)
              .then((res) => {
                for (const runId of res?.runs_started ?? []) runIds.push(runId)
                return res
              })
              .catch((err) => {
                const msg = `Detection returned events, but posting to automation failed: ${
                  err instanceof Error ? err.message : String(err)
                }`
                store.setTestingError(msg)
                if (!postError) postError = msg
                return null
              }),
          )
          await Promise.all(posts)
          if (postError) runError = postError
          if (postError) store.setTestingError(postError)
          await Promise.all([waitForRunCompletion(runIds), refreshRuns()])
        }
      } else {
        // No emitted events means no action path for automation.
        await refreshRuns()
      }
    } catch (e) {
      runError =
        `Could not reach the perception detect API at ${PERCEPTION_URL}. ` +
          `Start it (from the repo root) with:  python -m perception.server` +
          `\n(${e instanceof Error ? e.message : String(e)})`
      store.setTestingError(runError)
    } finally {
      store.finishTestingRun({ error: runError ?? undefined })
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
              <video
                src={preview}
                controls
                className="max-h-72 w-full object-contain"
                onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
              />
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
              <Label>Frame sampling</Label>
              <div className="text-xs text-muted-foreground">
                Auto-adjusted for compute: about {estimateVideoSampling().fps.toFixed(2)} fps,
                up to {estimateVideoSampling().maxFrames} frames
                {videoDuration ? ` (video duration ${videoDuration.toFixed(0)}s)` : ''}
              </div>
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

                  <EventsBlock events={result.events ?? []} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function parseResultEvents(raw: Record<string, unknown>[]): AppEvent[] {
  return raw
    .map((r): AppEvent | null => {
      if (!r || typeof r !== 'object') return null
      const event = r as Partial<AppEvent> & {
        event_id?: unknown
        event_type?: unknown
        timestamp?: unknown
        confidence?: unknown
        location?: unknown
      }
      if (
        typeof event.event_id !== 'string' ||
        typeof event.event_type !== 'string' ||
        typeof event.timestamp !== 'string' ||
        typeof event.confidence !== 'number' ||
        typeof event.location !== 'string'
      ) {
        return null
      }
      const confidence = Math.min(1, Math.max(0, event.confidence))
      return {
        event_id: event.event_id,
        event_type: event.event_type,
        timestamp: event.timestamp,
        confidence,
        location: event.location,
        snapshot_url: typeof event.snapshot_url === 'string' ? event.snapshot_url : undefined,
        payload: typeof event.payload === 'object' && event.payload !== null ? event.payload : undefined,
      }
    })
    .filter((event): event is AppEvent => Boolean(event))
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

      <EventsBlock events={r.events ?? []} />
    </div>
  )
}
