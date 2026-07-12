import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppEvent, Camera, EventType } from '../types'
import type { Store } from '../store'
import { eventMeta } from '../constants'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EventIcon } from './ui-kit'
import { Upload, Loader2, Video, Camera as CameraIcon, Play, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, cameraSnapshotUrl } from '../api'
import { LiveCameraStream } from './LiveCameraStream'

const PERCEPTION_URL =
  (import.meta.env.VITE_PERCEPTION_URL as string | undefined) ?? 'http://localhost:8008'
const DETECT_TIMEOUT_MS = 20000

interface DetectResult {
  kind?: 'image' | 'video'
  model: string
  mock: boolean
  frames_analyzed?: number
  events?: Record<string, unknown>[]
}

// A self-contained "insert a video" tile: upload a file, pick a live perception
// camera, or use the browser's own camera, then run real detection through the
// perception service. Any events it produces are posted to the automation
// service; the run IDs those start are handed back via `onRunsStarted` so the
// caller (Overview) can spin up the live agent viewer.
export function VideoCapture({
  store,
  onRunsStarted,
  onDetecting,
}: {
  store: Store
  onRunsStarted: (runIds: string[]) => void
  onDetecting?: (busy: boolean) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [lastEvents, setLastEvents] = useState<AppEvent[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [liveStreaming, setLiveStreaming] = useState(false)
  const latestMjpegFrameRef = useRef<Blob | null>(null)
  const analyzedMjpegFrameRef = useRef<Blob | null>(null)

  // Browser-camera source (getUserMedia — real permission prompt).
  const [browserStream, setBrowserStream] = useState<MediaStream | null>(null)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const mountedRef = useRef(true)
  const browserStreamRef = useRef<MediaStream | null>(null)
  useEffect(() => {
    // React Strict Mode runs setup -> cleanup -> setup in development. Reset the
    // flag during every setup so an async permission response is not mistaken
    // for a response after unmount.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      browserStreamRef.current?.getTracks().forEach((track) => track.stop())
      browserStreamRef.current = null
    }
  }, [])

  // Live perception cameras available for a snapshot grab.
  const liveCameras = useMemo<Camera[]>(
    () => store.cameras.filter((c) => c.status === 'live' && c.events_emitted !== undefined),
    [store.cameras],
  )
  const [cameraId, setCameraId] = useState('')
  useEffect(() => {
    if (!cameraId && liveCameras.length) setCameraId(liveCameras[0].id)
    if (cameraId && !liveCameras.some((camera) => camera.id === cameraId)) {
      setCameraId(liveCameras[0]?.id ?? '')
      setLiveStreaming(false)
    }
  }, [cameraId, liveCameras])

  const receiveMjpegFrame = useCallback((blob: Blob) => {
    latestMjpegFrameRef.current = blob
  }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = browserStream
  }, [browserStream])

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    onDetecting?.(busy)
  }, [busy, onDetecting])

  const pick = (f: File | null | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      setError('Please choose an image or video file.')
      return
    }
    setError(null)
    setSummary(null)
    setLastEvents([])
    setIsVideo(f.type.startsWith('video/'))
    setFile(f)
  }

  const startBrowserCamera = useCallback(async () => {
    setBrowserError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      setLiveStreaming(false)
      setFile(null)
      browserStreamRef.current = stream
      setBrowserStream(stream)
    } catch (e) {
      setBrowserError(`Could not access your camera: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const stopBrowserCamera = useCallback(() => {
    setBrowserStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop())
      if (browserStreamRef.current === prev) browserStreamRef.current = null
      return null
    })
  }, [])

  const captureBrowserFrame = useCallback(async (): Promise<File | null> => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (!blob) return null
    return new File([blob], 'browser-frame.jpg', { type: 'image/jpeg' })
  }, [])

  const detect = useCallback(
    async (target: File, live = false) => {
      const targetIsVideo = target.type.startsWith('video/')
      setBusy(true)
      setError(null)
      if (!live) onRunsStarted([])
      const runIds: string[] = []
      try {
        const fd = new FormData()
        fd.append('file', target)
        fd.append('events', '') // discovery mode — let the model find events
        fd.append('zone', 'zone_a')
        fd.append('min_confidence', '0.5')
        const endpoint = targetIsVideo ? '/detect_video' : '/detect'
        if (targetIsVideo) {
          const dur = videoDuration ?? 0
          const fps = dur >= 180 ? 0.4 : dur >= 60 ? 0.7 : 0.95
          fd.append('fps', String(Number(fps.toFixed(2))))
          fd.append('max_frames', String(Math.min(20, Math.max(4, Math.round((dur || 8) * fps)))))
        }
        const res = await fetch(`${PERCEPTION_URL}${endpoint}`, {
          method: 'POST',
          body: fd,
          signal: AbortSignal.timeout(targetIsVideo ? 60000 : DETECT_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`detect API returned ${res.status}`)
        const payload = (await res.json()) as DetectResult
        const events = parseEvents(payload.events ?? [])
        setLastEvents(events)
        setSummary(
          events.length
            ? `Detected ${events.length} event${events.length > 1 ? 's' : ''}${
                payload.mock ? ' (mock model)' : ''
              }`
            : 'No actionable events found.',
        )
        if (events.length) {
          store.ingestEvents(events)
          if (api.configured()) {
            await Promise.all(
              events.map((event) =>
                api
                  .postEvent(event)
                  .then((r) => {
                    for (const id of r?.runs_started ?? []) runIds.push(id)
                  })
                  .catch(() => {}),
              ),
            )
            if (runIds.length) onRunsStarted([...runIds])
            store.refreshRuns()
          }
        }
      } catch (e) {
        setError(
          e instanceof Error && e.name === 'TimeoutError'
            ? 'The vision model timed out. Try a shorter clip or a single frame.'
            : `Could not reach the perception service at ${PERCEPTION_URL}. Start it with: python -m perception.server`,
        )
      } finally {
        setBusy(false)
      }
    },
    [videoDuration, store, onRunsStarted],
  )

  const detectRef = useRef(detect)
  useEffect(() => {
    detectRef.current = detect
  }, [detect])

  // Opening the browser webcam is itself the start action: keep the <video>
  // live and analyze freshly rendered frames continuously until Stop camera.
  useEffect(() => {
    if (!browserStream) return
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        const frame = await captureBrowserFrame()
        if (cancelled) break
        if (frame) {
          await detectRef.current(frame, true)
        }
        // Match the MJPEG sampler cadence and avoid a tight loop if a mocked or
        // unusually fast detector resolves immediately.
        await new Promise((resolve) => setTimeout(resolve, frame ? 500 : 100))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [browserStream, captureBrowserFrame])

  useEffect(() => {
    if (!liveStreaming || !cameraId) return
    let cancelled = false
    latestMjpegFrameRef.current = null
    analyzedMjpegFrameRef.current = null
    ;(async () => {
      while (!cancelled) {
        const blob = latestMjpegFrameRef.current
        if (!blob || blob === analyzedMjpegFrameRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          continue
        }
        analyzedMjpegFrameRef.current = blob
        await detectRef.current(
          new File([blob], `camera-${cameraId}-mjpeg-frame.jpg`, {
            type: blob.type || 'image/jpeg',
          }),
          true,
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cameraId, liveStreaming])

  const grabAndDetect = useCallback(async () => {
    // Prefer browser camera if active, then a live perception camera.
    if (browserStream) {
      const frame = await captureBrowserFrame()
      if (frame) await detect(frame)
      return
    }
    const cam = liveCameras.find((c) => c.id === cameraId)
    if (!cam) return
    try {
      const res = await fetch(`${cameraSnapshotUrl(cam.id)}?t=${Date.now()}`)
      if (!res.ok) throw new Error(`snapshot ${res.status}`)
      const blob = await res.blob()
      await detect(new File([blob], `camera-${cam.id}.jpg`, { type: blob.type || 'image/jpeg' }))
    } catch (e) {
      setError(`Could not grab a frame from ${cam.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [browserStream, captureBrowserFrame, liveCameras, cameraId, detect])

  const canRunFile = !!file && !busy
  const canGrab = (!!browserStream || !!cameraId) && !busy

  return (
    <div className="flex flex-col gap-3">
      {/* Preview / drop zone */}
      <div
        role="button"
        tabIndex={preview || browserStream || liveStreaming ? -1 : 0}
        className={cn(
          'relative flex min-h-48 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dragging ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40',
        )}
        onClick={() => !preview && !browserStream && !liveStreaming && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!preview && !browserStream && !liveStreaming && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
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
        {liveStreaming && cameraId ? (
          <LiveCameraStream cameraId={cameraId} onFrame={receiveMjpegFrame} />
        ) : browserStream ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            data-testid="browser-camera-preview"
            className="max-h-64 w-full object-contain"
          />
        ) : preview && isVideo ? (
          <video
            src={preview}
            controls
            className="max-h-64 w-full object-contain"
            onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
          />
        ) : preview ? (
          <img src={preview} alt="preview" className="max-h-64 w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <Upload className="size-7" />
            <div>
              <b className="text-foreground">Click to upload</b> or drag a video / image
            </div>
            <span className="text-xs">A short clip, a frame, or a photo (MP4 / PNG / JPG)</span>
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

      {/* Source controls */}
      <div className="flex flex-wrap items-center gap-2">
        {file && (
          <Button variant="olive" size="sm" disabled={!canRunFile} onClick={() => detect(file)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {busy ? 'Analyzing…' : 'Run detection'}
          </Button>
        )}
        {(file || browserStream) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              stopBrowserCamera()
              setFile(null)
              inputRef.current?.click()
            }}
          >
            <Video className="size-4" /> Replace
          </Button>
        )}

        {liveCameras.length > 0 && !browserStream && (
          <div className="flex items-center gap-2">
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {liveCameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.zone})
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" disabled={!canGrab} onClick={grabAndDetect}>
              <CameraIcon className="size-4" /> Grab frame
            </Button>
            <Button
              variant={liveStreaming ? 'olive' : 'secondary'}
              size="sm"
              onClick={() => {
                stopBrowserCamera()
                setFile(null)
                setError(null)
                setSummary(null)
                setLastEvents([])
                setLiveStreaming((active) => !active)
              }}
            >
              <Video className="size-4" /> {liveStreaming ? 'Stop live' : 'Start live'}
            </Button>
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={startBrowserCamera}
          disabled={busy || !!browserStream}
        >
          {browserStream ? <Loader2 className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
          {browserStream ? 'Analyzing webcam live' : 'Use my camera'}
        </Button>
        {browserStream && (
          <Button variant="ghost" size="sm" onClick={stopBrowserCamera}>
            Stop camera
          </Button>
        )}
      </div>

      {browserError && <p className="text-xs text-destructive">{browserError}</p>}
      {error && (
        <div className="whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </div>
      )}
      {summary && !error && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Check className="size-3.5 text-emerald-500" /> {summary}
          </span>
          {lastEvents.map((e) => {
            const m = eventMeta(e.event_type)
            return (
              <Badge key={e.event_id} variant="outline" className="gap-1" style={{ color: m.color, borderColor: `${m.color}40` }}>
                <EventIcon type={e.event_type} className="size-3" />
                {m.label}
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}

function parseEvents(raw: Record<string, unknown>[]): AppEvent[] {
  return raw
    .map((r): AppEvent | null => {
      if (!r || typeof r !== 'object') return null
      const e = r as Partial<AppEvent> & Record<string, unknown>
      if (
        typeof e.event_id !== 'string' ||
        typeof e.event_type !== 'string' ||
        typeof e.timestamp !== 'string' ||
        typeof e.confidence !== 'number' ||
        typeof e.location !== 'string'
      ) {
        return null
      }
      return {
        event_id: e.event_id,
        event_type: e.event_type as EventType,
        timestamp: e.timestamp,
        confidence: Math.min(1, Math.max(0, e.confidence)),
        location: e.location,
        snapshot_url: typeof e.snapshot_url === 'string' ? e.snapshot_url : undefined,
        payload: typeof e.payload === 'object' && e.payload !== null ? (e.payload as Record<string, unknown>) : undefined,
      }
    })
    .filter((e): e is AppEvent => !!e)
}
