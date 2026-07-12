import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { ManualEvents } from './ManualEvents'
import { ConfidenceBar, EventIcon } from '../components/ui-kit'
import { Upload, Check, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, cameraSnapshotUrl } from '../api'

const PERCEPTION_URL =
  (import.meta.env.VITE_PERCEPTION_URL as string | undefined) ?? 'http://localhost:8008'
const TESTING_SESSION_KEY = 'snowglobe.testing.session.v1'
// Client-side cap on a single /detect call. The perception service's own VLM
// timeout is 60s (see perception/config.py VLM_TIMEOUT) — when the upstream
// model API stalls (it does; this happens in practice), waiting that long
// would freeze the whole live loop on one bad frame. Abort well before that
// and let the next tick grab a fresh screenshot instead of waiting it out.
const DETECT_TIMEOUT_MS = 20000
// Live mode renders like a video result (summary + frame timeline) instead of
// replacing a single-frame verdict every tick — that swap-to-blank-then-fill
// on every cycle read as "it keeps reloading and never lands." The timeline
// is uncapped by design (cleared only when a new live session starts).

interface GroundedObject {
  phrase: string
  confidence: number
  boxes: number[][]
}
interface Verdict {
  event_type: EventType
  detected?: boolean
  confidence?: number
  count?: number | null
  detail?: string | null
  grounded?: boolean | null
  objects?: GroundedObject[] | null
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
  grounding?: boolean
  grounding_model?: string | null
  verdicts?: Verdict[] // image
  frames?: FrameResult[] // video
  summary?: SummaryRow[] // video
  frames_analyzed?: number
  events?: Record<string, unknown>[]
}

type TestingFileMeta = {
  name: string
  type: string
  size: number
  lastModified: number
}

type TestingSessionDraft = {
  discover: boolean
  selected: string[]
  customType: string
  zone: string
  minConf: number
  fileMeta?: TestingFileMeta | null
}

function normalizeSessionDraft(input: unknown): TestingSessionDraft {
  if (!input || typeof input !== 'object') return defaultTestingSessionDraft()
  const parsed = input as Partial<TestingSessionDraft>
  const selected =
    Array.isArray(parsed.selected) && parsed.selected.every((item) => typeof item === 'string')
      ? (parsed.selected as string[])
      : [...SUGGESTED_EVENT_TYPES]
  const zone = typeof parsed.zone === 'string' && parsed.zone ? parsed.zone : 'zone_a'
  const customType = typeof parsed.customType === 'string' ? parsed.customType : ''
  const minConf =
    typeof parsed.minConf === 'number' && Number.isFinite(parsed.minConf)
      ? Math.max(0, Math.min(1, parsed.minConf))
      : 0.5
  const discover = parsed.discover !== false
  const fileMeta =
    parsed.fileMeta && typeof parsed.fileMeta === 'object'
      ? {
          name: typeof (parsed.fileMeta as TestingFileMeta).name === 'string' ? (parsed.fileMeta as TestingFileMeta).name : '',
          type: typeof (parsed.fileMeta as TestingFileMeta).type === 'string' ? (parsed.fileMeta as TestingFileMeta).type : '',
          size: typeof (parsed.fileMeta as TestingFileMeta).size === 'number' ? (parsed.fileMeta as TestingFileMeta).size : 0,
          lastModified:
            typeof (parsed.fileMeta as TestingFileMeta).lastModified === 'number'
              ? (parsed.fileMeta as TestingFileMeta).lastModified
              : Date.now(),
        }
      : null
  if (!fileMeta?.name || !fileMeta.type) {
    return { discover, selected, customType, zone, minConf, fileMeta: null }
  }
  return { discover, selected, customType, zone, minConf, fileMeta }
}

function defaultTestingSessionDraft(): TestingSessionDraft {
  return {
    discover: true,
    selected: [...SUGGESTED_EVENT_TYPES],
    customType: '',
    zone: 'zone_a',
    minConf: 0.5,
    fileMeta: null,
  }
}

function loadTestingSessionDraft(): TestingSessionDraft {
  try {
    const raw = localStorage.getItem(TESTING_SESSION_KEY)
    if (!raw) return defaultTestingSessionDraft()
    const parsed = JSON.parse(raw)
    return normalizeSessionDraft(parsed)
  } catch {
    return defaultTestingSessionDraft()
  }
}

function saveTestingSessionDraft(draft: TestingSessionDraft) {
  try {
    localStorage.setItem(TESTING_SESSION_KEY, JSON.stringify(draft))
  } catch {
    /* ignore */
  }
}

export function Testing({ store }: { store: Store }) {
  const initialDraft = useMemo(() => loadTestingSessionDraft(), [])
  const [preview, setPreview] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [discover, setDiscover] = useState<boolean>(initialDraft.discover)
  const [selected, setSelected] = useState<EventType[]>(initialDraft.selected)
  const [customType, setCustomType] = useState(initialDraft.customType)
  const [zone, setZone] = useState(initialDraft.zone)
  const [minConf, setMinConf] = useState<number>(initialDraft.minConf)
  const [fileMeta, setFileMeta] = useState<TestingFileMeta | null>(() => initialDraft.fileMeta ?? null)
  const [cameraId, setCameraId] = useState<string>('')
  const [liveStreaming, setLiveStreaming] = useState(false)
  // Live-mode analysis accumulates into this timeline (rendered via
  // VideoResults, same as an uploaded video) instead of replacing a single
  // result every tick.
  const [liveFrames, setLiveFrames] = useState<FrameResult[]>([])
  const [liveEvents, setLiveEvents] = useState<Record<string, unknown>[]>([])
  const [liveModelLabel, setLiveModelLabel] = useState<{ model: string; mock: boolean } | null>(null)
  const [liveBusy, setLiveBusy] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const liveFrameSeqRef = useRef(0)
  const liveStartedAtRef = useRef<number | null>(null)
  // Browser-camera source: uses getUserMedia (the real permission prompt)
  // instead of the perception service opening a device on its own host —
  // this is what lets a deployed visitor use their own camera.
  const [browserStream, setBrowserStream] = useState<MediaStream | null>(null)
  const [browserLive, setBrowserLive] = useState(false)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const file = store.testingFile
  const liveCameras = useMemo(
    () =>
      store.cameras.filter(
        (camera) => camera.status === 'live' && camera.events_emitted !== undefined,
      ),
    [store.cameras],
  )
  const isVideo = file
    ? file.type.startsWith('video/')
    : (fileMeta?.type?.startsWith('video/') ?? false)
  const busy = store.testingRun?.running ?? false
  const result = (store.testingResult as DetectResult | null) ?? null
  const error = store.testingError
  // Live mode's accumulated timeline, shaped exactly like a /detect_video
  // response so it can render through the same VideoResults component.
  const liveResult: DetectResult | null = useMemo(() => {
    if (!liveModelLabel) return null
    return {
      kind: 'video',
      model: liveModelLabel.model,
      mock: liveModelLabel.mock,
      summary: computeLiveSummary(liveFrames, minConf),
      frames: liveFrames,
      frames_analyzed: liveFrames.length,
      events: liveEvents,
    }
  }, [liveModelLabel, liveFrames, liveEvents, minConf])
  const selectedCam = useMemo(
    () => liveCameras.find((camera) => camera.id === cameraId),
    [liveCameras, cameraId],
  )
  const showLiveResults = (liveStreaming && !!selectedCam) || browserLive

  useEffect(() => {
    if (!cameraId && liveCameras.length > 0) {
      setCameraId(liveCameras[0].id)
      return
    }
    if (cameraId && !liveCameras.some((camera) => camera.id === cameraId)) {
      setCameraId(liveCameras[0]?.id ?? '')
    }
  }, [cameraId, liveCameras])

  // Live camera went away (removed/paused) — drop out of live mode with it.
  useEffect(() => {
    if (!selectedCam) setLiveStreaming(false)
  }, [selectedCam])

  // Starting a live session (either source) begins a fresh timeline (revoking
  // any thumbnail object URLs from the previous session so they don't leak).
  useEffect(() => {
    if (!liveStreaming && !browserLive) return
    setLiveFrames((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.thumb))
      return []
    })
    setLiveEvents([])
    setLiveModelLabel(null)
    setLiveError(null)
    liveFrameSeqRef.current = 0
    liveStartedAtRef.current = Date.now()
  }, [liveStreaming, browserLive, selectedCam?.id])

  // Attach/detach the browser camera's MediaStream to the <video> element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = browserStream
  }, [browserStream])

  // Release the camera hardware whenever the stream changes or on unmount —
  // getUserMedia tracks keep the camera light on until explicitly stopped.
  useEffect(() => {
    return () => {
      browserStream?.getTracks().forEach((t) => t.stop())
    }
  }, [browserStream])

  const startBrowserCamera = useCallback(async () => {
    setBrowserError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      setLiveStreaming(false) // only one live source analyzed at a time
      setBrowserStream(stream)
    } catch (e) {
      setBrowserError(`Could not access your camera: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const stopBrowserCamera = useCallback(() => {
    setBrowserLive(false)
    setBrowserStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop())
      return null
    })
  }, [])

  // Draws the current video frame to an offscreen canvas and encodes it as a
  // JPEG — the browser-camera equivalent of fetching a perception snapshot.
  const captureBrowserFrame = useCallback(async (): Promise<{ file: File; blob: Blob } | null> => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return null
    return { file: new File([blob], 'browser-camera-frame.jpg', { type: 'image/jpeg' }), blob }
  }, [])

  // Revoke any remaining thumbnail object URLs when the page unmounts.
  useEffect(() => {
    return () => {
      liveFrames.forEach((f) => URL.revokeObjectURL(f.thumb))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  useEffect(() => {
    const effectivePreviewName = file?.name ?? fileMeta?.name
    saveTestingSessionDraft({
      discover,
      selected,
      customType,
      zone,
      minConf,
      fileMeta: effectivePreviewName
        ? {
            name: effectivePreviewName,
            type:
              file?.type ??
              fileMeta?.type ??
              (isVideo ? 'video/mp4' : 'image/png'),
            size: file?.size ?? fileMeta?.size ?? 0,
            lastModified: file?.lastModified ?? fileMeta?.lastModified ?? Date.now(),
          }
        : null,
    })
  }, [discover, fileMeta, file, isVideo, minConf, selected, customType, zone])

  const pick = (f: File | null | undefined) => {
    if (!f) return
    const image = f.type.startsWith('image/')
    if (!image && !f.type.startsWith('video/')) {
      store.setTestingError('Please choose an image or video file.')
      return
    }
    setFileMeta({
      name: f.name,
      type: f.type,
      size: f.size,
      lastModified: f.lastModified,
    })
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

  const estimateVideoSampling = useCallback((videoIsTarget = isVideo) => {
    if (!videoIsTarget || !videoDuration || !Number.isFinite(videoDuration)) {
      return { fps: 0.8, maxFrames: 8 }
    }
    const fps = videoDuration >= 180 ? 0.4 : videoDuration >= 60 ? 0.7 : 0.95
    const maxFrames = Math.min(20, Math.max(4, Math.round(videoDuration * fps)))
    return { fps: Number(fps.toFixed(2)), maxFrames }
  }, [isVideo, videoDuration])

  const canRunFromUpload = !!file && (discover || selected.length > 0)
  const canRunFromCamera = !!cameraId && (discover || selected.length > 0)
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
  // One live-mode tick: analyzes a single grabbed frame and appends it to the
  // timeline, rather than replacing a single result the way `run()` does for
  // uploads/manual grabs. Deliberately doesn't touch store.testingResult/
  // testingRun — those stay owned by the manual flow.
  const runLiveAnalysisTick = useCallback(
    async (activeFile: File, blob: Blob) => {
      setLiveBusy(true)
      try {
        const fd = new FormData()
        fd.append('file', activeFile)
        fd.append('events', discover ? '' : selected.join(','))
        fd.append('zone', zone)
        fd.append('min_confidence', String(minConf))
        const res = await fetch(`${PERCEPTION_URL}/detect`, {
          method: 'POST',
          body: fd,
          signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
        })
        if (!res.ok) {
          const body = await res.text()
          throw new Error(`detect API returned ${res.status}: ${body.slice(0, 200)}`)
        }
        const payload = (await res.json()) as DetectResult
        const events = parseResultEvents(payload.events ?? [])
        setLiveModelLabel({ model: payload.model, mock: payload.mock })
        setLiveError(null)

        const startedAt = liveStartedAtRef.current ?? Date.now()
        const frame: FrameResult = {
          index: liveFrameSeqRef.current++,
          t_sec: Math.round((Date.now() - startedAt) / 1000),
          thumb: URL.createObjectURL(blob),
          verdicts: payload.verdicts ?? [],
        }
        setLiveFrames((prev) => [...prev, frame])

        if (events.length) {
          setLiveEvents((prev) => [...(payload.events ?? []), ...prev].slice(0, 50))
          store.ingestEvents(events)
          if (api.configured()) {
            // Fire-and-forget: live mode shouldn't block the next tick on
            // automation's run bookkeeping the way the manual flow does.
            events.forEach((event) => {
              api.postEvent(event).catch((err) => {
                setLiveError(
                  `Detection returned events, but posting to automation failed: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                )
              })
            })
          }
        }
      } catch (e) {
        setLiveError(
          e instanceof Error && e.name === 'TimeoutError'
            ? `Vision model call timed out after ${DETECT_TIMEOUT_MS / 1000}s — moving on to the next frame.`
            : `Live analysis failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      } finally {
        setLiveBusy(false)
      }
    },
    [discover, selected, zone, minConf, store],
  )

  const runFromCamera = useCallback(async () => {
    const selectedCam = liveCameras.find((camera) => camera.id === cameraId)
    if (!selectedCam) {
      store.setTestingError('No live camera selected for testing.')
      return
    }
    try {
      const url = `${cameraSnapshotUrl(selectedCam.id)}?t=${Date.now()}`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`snapshot fetch failed with ${res.status}`)
      }
      const blob = await res.blob()
      const snap = new File(
        [blob],
        `camera-${selectedCam.id}-frame.jpg`,
        { type: blob.type || 'image/jpeg' },
      )

      if (liveStreaming) {
        await runLiveAnalysisTick(snap, blob)
        return
      }

      store.setTestingError(null)
      store.setTestingResult(null)
      store.setTestingFile(snap)
      setFileMeta({
        name: snap.name,
        type: snap.type,
        size: snap.size,
        lastModified: snap.lastModified,
      })
      await run(snap)
    } catch (e) {
      const msg = `Could not capture a frame from ${selectedCam.name}: ${
        e instanceof Error ? e.message : String(e)
      }`
      if (liveStreaming) setLiveError(msg)
      else store.setTestingError(msg)
    }
  }, [cameraId, liveCameras, liveStreaming, run, runLiveAnalysisTick, store])

  // Kept in a ref so the analysis-loop effect below doesn't need runFromCamera
  // in its deps — that identity churns every render (it closes over `run`,
  // which is unmemoized), which would otherwise reset the interval before it
  // ever fires at low fps.
  const runFromCameraRef = useRef(runFromCamera)
  useEffect(() => {
    runFromCameraRef.current = runFromCamera
  }, [runFromCamera])

  // Live mode: the preview streams smoothly (see LiveCameraStream) at its own
  // fixed rate, decoupled from analysis — analysis isn't pinned to any fps at
  // all. It just runs back-to-back: grab a frame, wait for that one call to
  // resolve, immediately grab the next. The only pacing is however long the
  // vision model actually takes to respond (DETECT_TIMEOUT_MS bounds the
  // worst case), so it goes as fast as the model allows without piling up
  // overlapping calls.
  useEffect(() => {
    if (!liveStreaming || !selectedCam) return
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        await runFromCameraRef.current()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [liveStreaming, selectedCam?.id])

  // Kept in a ref for the same reason as runFromCameraRef above — the loop
  // below shouldn't restart just because runLiveAnalysisTick's identity
  // churns (it closes over discover/selected/zone/minConf/store).
  const runLiveAnalysisTickRef = useRef(runLiveAnalysisTick)
  useEffect(() => {
    runLiveAnalysisTickRef.current = runLiveAnalysisTick
  }, [runLiveAnalysisTick])

  // Same back-to-back pacing as the perception-camera loop above, but
  // capturing frames from the browser's own camera via canvas instead of
  // fetching a snapshot from the perception service.
  useEffect(() => {
    if (!browserLive || !browserStream) return
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        const captured = await captureBrowserFrame()
        if (cancelled) break
        if (captured) {
          await runLiveAnalysisTickRef.current(captured.file, captured.blob)
        } else {
          // Video element not ready for its first frame yet — brief wait.
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [browserLive, browserStream, captureBrowserFrame])

  async function run(inputFile?: File) {
    const activeFile = inputFile ?? file
    if (!activeFile) return
    const activeIsVideo = activeFile.type.startsWith('video/')
    const mediaKind: 'image' | 'video' = activeIsVideo ? 'video' : 'image'
    const runId = store.startTestingRun({
      kind: mediaKind,
      fileName: activeFile.name || 'upload',
      zone,
    })
    let latestPayload: Record<string, unknown> = { kind: mediaKind }
    let events: AppEvent[] = []
    const runIds: string[] = []
    let runError: string | null = null
    store.setTestingError(null)
    store.setTestingResult(null)

    try {
      const fd = new FormData()
      fd.append('file', activeFile)
      // Empty `events` → open-ended discovery on the server.
      fd.append('events', discover ? '' : selected.join(','))
      fd.append('zone', zone)
      fd.append('min_confidence', String(minConf))
      const endpoint = activeIsVideo ? '/detect_video' : '/detect'
      if (activeIsVideo) {
        const { fps, maxFrames } = estimateVideoSampling(activeIsVideo)
        fd.append('fps', String(fps))
        fd.append('max_frames', String(maxFrames))
      }
      const res = await fetch(`${PERCEPTION_URL}${endpoint}`, {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`detect API returned ${res.status}: ${body.slice(0, 200)}`)
      }
      const payload = (await res.json()) as DetectResult
      latestPayload = { ...payload } as Record<string, unknown>
      events = parseResultEvents(payload.events ?? [])
      store.setTestingResult(payload)

      if (events.length) {
        // Persist testing detections into the UI event log immediately.
        store.ingestEvents(events)

        // Send to automation so workflow runs are created and reflected in Runs.
        let postError: string | null = null
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
      }
      // No emitted events means no action path for automation — nothing
      // could have started a run, so there's nothing worth polling for.
      // Skipping this in the common (no-detection) case matters a lot in
      // live mode: the old unconditional 3x/900ms poll kept `busy` true for
      // ~1.8s of dead time on every quiet frame, well past the analysis
      // interval, which made the loop look permanently "stuck calling the
      // vision model" even though it was landing results the whole time.
    } catch (e) {
      runError =
        e instanceof Error && e.name === 'TimeoutError'
          ? `Vision model call timed out after ${DETECT_TIMEOUT_MS / 1000}s — the upstream model API is slow ` +
            `right now. Moving on to the next frame.`
          : `Could not reach the perception detect API at ${PERCEPTION_URL}. ` +
            `Start it (from the repo root) with:  python -m perception.server` +
            `\n(${e instanceof Error ? e.message : String(e)})`
      store.setTestingError(runError)
    } finally {
      store.finishTestingRun({
        id: runId,
        error: runError ?? undefined,
        payload: latestPayload,
        detectedEvents: events,
        runIds,
        zone,
      })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ManualEvents store={store} />
      {/* Left: upload + controls */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div
            role="button"
            tabIndex={preview ? -1 : 0}
            aria-label="Upload an image or video"
            className={cn(
              'flex min-h-52 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              dragging ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40',
            )}
            onClick={() =>
              !preview && !liveStreaming && !browserStream && inputRef.current?.click()
            }
            onKeyDown={(e) => {
              if (
                !preview &&
                !liveStreaming &&
                !browserStream &&
                (e.key === 'Enter' || e.key === ' ')
              ) {
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
            {browserStream ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="max-h-72 w-full object-contain"
              />
            ) : liveStreaming && selectedCam ? (
              <LiveCameraStream cameraId={selectedCam.id} />
            ) : preview && isVideo ? (
              <VideoWithBoxes
                src={preview}
                frames={result?.frames ?? []}
                onLoadedMetadata={(d) => setVideoDuration(d)}
              />
            ) : preview ? (
              <img src={preview} alt="upload preview" className="max-h-72 w-full object-contain" />
            ) : fileMeta ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-xs text-muted-foreground">
                <Upload className="size-7" />
                <div>
                  <b className="text-sm text-foreground">{busy ? 'Running test on' : 'Uploaded'}</b>{' '}
                  <span className="font-medium text-foreground">{fileMeta.name}</span>
                </div>
                <span>Type: {fileMeta.type || 'unknown'} · Size: {Math.round(fileMeta.size / 1024)} KB</span>
                {busy && <span className="text-amber-500">Test is still running.</span>}
              </div>
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
              aria-label="Choose an image or video file"
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          {(file || fileMeta) && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">
                {file?.name ?? fileMeta?.name}
                <span className="ml-2 opacity-70">
                  {busy && !file ? '(running from persisted session)' : ''}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
                Replace
              </Button>
            </div>
          )}

          {liveCameras.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Or use a live camera for testing</Label>
                {selectedCam && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Live</span>
                    <Switch
                      checked={liveStreaming}
                      onCheckedChange={(v) => {
                        if (v) stopBrowserCamera() // only one live source analyzed at a time
                        setLiveStreaming(v)
                      }}
                      aria-label="Stream live preview"
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {liveCameras.map((camera) => (
                    <option key={camera.id} value={camera.id}>
                      {camera.name} ({camera.zone})
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  disabled={!canRunFromCamera || busy || liveStreaming}
                  onClick={runFromCamera}
                >
                  Grab frame and run
                </Button>
              </div>
              {liveStreaming && selectedCam ? (
                <p className="text-xs text-muted-foreground">
                  Preview above streams continuously (~8 fps). Analysis isn't pinned to any fps —
                  it grabs a fresh screenshot as soon as the previous one finishes, so it goes as
                  fast as the vision model can respond.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Grabs one snapshot from the selected live camera and sends it to the same
                  testing detector. Toggle Live to stream continuously and analyze back-to-back.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Or use your own camera</Label>
              {browserStream && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Live</span>
                  <Switch
                    checked={browserLive}
                    onCheckedChange={setBrowserLive}
                    aria-label="Analyze from browser camera"
                  />
                </div>
              )}
            </div>
            {browserError && (
              <div className="whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {browserError}
              </div>
            )}
            <Button
              variant="secondary"
              onClick={browserStream ? stopBrowserCamera : startBrowserCamera}
            >
              {browserStream ? 'Stop camera' : 'Use my camera'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Uses your browser's camera permission (getUserMedia) — this works from any device,
              not just this machine. Toggle Live to analyze back-to-back once it's on.
            </p>
          </div>

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

          <Button variant="olive" disabled={!canRunFromUpload || busy} onClick={() => run()}>
            {busy ? 'Running detection…' : discover ? 'Discover events' : 'Run detection'}
          </Button>
        </CardContent>
      </Card>

      {/* Right: results */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Results</CardTitle>
          {showLiveResults ? (
            liveResult && <Badge variant="secondary">{liveResult.mock ? 'mock' : liveResult.model}</Badge>
          ) : (
            result && (
              <div className="flex min-w-0 items-center gap-1.5">
                {result.grounding && (
                  <Badge
                    variant="outline"
                    className="gap-1 whitespace-nowrap"
                    title={result.grounding_model ? `Boxes from ${result.grounding_model}` : 'Object detector confirmed findings'}
                  >
                    <ShieldCheck className="size-3" /> grounded
                  </Badge>
                )}
                <Badge variant="secondary" className="max-w-[220px] truncate" title={result.mock ? 'mock' : result.model}>
                  {result.mock ? 'mock' : result.model}
                </Badge>
              </div>
            )
          )}
        </CardHeader>
        <CardContent>
          {showLiveResults ? (
            <>
              {liveError && (
                <div className="mb-3 whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  {liveError}
                </div>
              )}
              {!liveResult && (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> waiting for the first frame…
                </div>
              )}
              {liveResult && <VideoResults r={liveResult} minConf={minConf} />}
              {liveBusy && liveResult && (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> analyzing next frame…
                </div>
              )}
            </>
          ) : (
            <>
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
                            <GroundingNote grounded={v.grounded} objects={v.objects} />
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Ticks its own state on an interval so the smooth preview doesn't re-render
// the whole Testing page.
function LiveCameraStream({ cameraId }: { cameraId: string }) {
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    // ~8fps matches the perception service's own preview refresh rate
    // (capture.py _PREVIEW_HZ) — polling faster just re-fetches a stale JPEG.
    const t = setInterval(() => setTick(Date.now()), 125)
    return () => clearInterval(t)
  }, [cameraId])

  return (
    <img
      src={`${cameraSnapshotUrl(cameraId)}?t=${tick}`}
      alt="live camera preview"
      className="max-h-72 w-full rounded-lg border object-contain"
    />
  )
}

// Aggregates a live-mode frame timeline into the same SummaryRow shape
// /detect_video returns, so the live view can reuse VideoResults as-is.
function computeLiveSummary(frames: FrameResult[], minConf: number): SummaryRow[] {
  const byType = new Map<string, SummaryRow>()
  for (const frame of frames) {
    for (const v of frame.verdicts) {
      const row = byType.get(v.event_type) ?? {
        event_type: v.event_type,
        fired: false,
        frames_detected: 0,
        frames_total: 0,
        peak_confidence: 0,
        count: null,
      }
      if (v.detected) {
        row.frames_detected += 1
        if ((v.confidence ?? 0) >= minConf) row.fired = true
      }
      row.peak_confidence = Math.max(row.peak_confidence, v.confidence ?? 0)
      if (typeof v.count === 'number') row.count = v.count
      byType.set(v.event_type, row)
    }
  }
  for (const row of byType.values()) row.frames_total = frames.length
  return [...byType.values()].sort((a, b) => b.peak_confidence - a.peak_confidence)
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

function GroundingNote({
  grounded,
  objects,
}: {
  grounded?: boolean | null
  objects?: { phrase: string; confidence: number }[] | null
}) {
  // grounded null/undefined → the object detector wasn't consulted (grounding
  // off, or a targeted verdict); render nothing.
  if (grounded === undefined || grounded === null) return null
  if (grounded) {
    const seen = (objects ?? [])
      .map((o) => o.phrase)
      .slice(0, 3)
      .join(', ')
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-600">
        <ShieldCheck className="size-3" />
        Confirmed by object detector{seen && `: ${seen}`}
      </div>
    )
  }
  return (
    <div className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
      <ShieldAlert className="size-3" />
      Not corroborated by object detector — confidence reduced
    </div>
  )
}

// A sampled frame with the object detector's bounding boxes overlaid. Boxes are
// normalized [x1,y1,x2,y2] in 0..1. We render the image with object-contain (not
// cover) so no part is cropped and the normalized coords line up exactly with
// the SVG overlay (viewBox 0..100, also non-distorting). `size` picks the strip
// thumb (tiny) vs the detection gallery (large + labels).
function FrameThumb({
  thumb,
  index,
  verdicts,
  size = 'thumb',
}: {
  thumb: string
  index: number
  verdicts: Verdict[]
  size?: 'thumb' | 'large'
}) {
  const boxes: { x: number; y: number; w: number; h: number; label: string }[] = []
  for (const v of verdicts) {
    for (const o of v.objects ?? []) {
      for (const b of o.boxes ?? []) {
        if (b.length === 4) {
          const [x1, y1, x2, y2] = b
          boxes.push({
            x: x1 * 100,
            y: y1 * 100,
            w: (x2 - x1) * 100,
            h: (y2 - y1) * 100,
            label: o.phrase,
          })
        }
      }
    }
  }
  const large = size === 'large'
  // The image sizes the box; the SVG is stretched to exactly cover the image
  // (both share the same rectangle), so normalized coords map 1:1 regardless of
  // the frame's aspect ratio. Using object-fill on a container that matches the
  // image avoids any letterbox/crop drift between the image and the overlay.
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-md border bg-muted',
        large ? 'max-w-md' : 'h-16',
      )}
    >
      <img
        src={thumb}
        alt={`frame ${index}`}
        className={cn('block w-full', large ? 'h-auto' : 'h-16 object-cover')}
      />
      {boxes.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {boxes.map((b, i) => (
            <g key={i}>
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                fill="none"
                stroke="#c1440e"
                strokeWidth={large ? 2 : 1.5}
                vectorEffect="non-scaling-stroke"
              />
              {large && (
                <text
                  x={b.x + 0.5}
                  y={Math.max(b.y - 1, 3)}
                  fill="#c1440e"
                  fontSize={5}
                  fontWeight={700}
                >
                  {b.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}

// The uploaded <video> with detection boxes drawn on top, synced to playback.
// As the video plays, we pick the analyzed frame whose timestamp is nearest the
// current time and draw its boxes. Handles object-contain letterboxing so boxes
// land on the video content, not the black bars.
function VideoWithBoxes({
  src,
  frames,
  onLoadedMetadata,
}: {
  src: string
  frames: FrameResult[]
  onLoadedMetadata?: (duration: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  // Rendered video rect inside the element (accounts for object-contain bars).
  const [rect, setRect] = useState<{ left: number; top: number; w: number; h: number } | null>(null)

  const computeRect = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.videoWidth || !v.videoHeight) return
    const cw = v.clientWidth
    const ch = v.clientHeight
    const scale = Math.min(cw / v.videoWidth, ch / v.videoHeight)
    const w = v.videoWidth * scale
    const h = v.videoHeight * scale
    setRect({ left: (cw - w) / 2, top: (ch - h) / 2, w, h })
  }, [])

  useEffect(() => {
    const onResize = () => computeRect()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [computeRect])

  // Sorted analyzed frames with at least one box.
  const boxedFrames = useMemo(
    () =>
      frames
        .filter((f) => f.verdicts.some((v) => (v.objects ?? []).some((o) => (o.boxes ?? []).length)))
        .sort((a, b) => a.t_sec - b.t_sec),
    [frames],
  )

  // Nearest boxed frame to the current playback time (within ~1.2s so boxes
  // don't linger far from where they were detected).
  const active = useMemo(() => {
    if (!boxedFrames.length) return null
    let best = boxedFrames[0]
    let bestD = Math.abs(best.t_sec - t)
    for (const f of boxedFrames) {
      const d = Math.abs(f.t_sec - t)
      if (d < bestD) {
        best = f
        bestD = d
      }
    }
    return bestD <= 1.2 ? best : null
  }, [boxedFrames, t])

  const boxes = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number; label: string }[] = []
    for (const v of active?.verdicts ?? []) {
      for (const o of v.objects ?? []) {
        for (const b of o.boxes ?? []) {
          if (b.length === 4) {
            const [x1, y1, x2, y2] = b
            out.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, label: o.phrase })
          }
        }
      }
    }
    return out
  }, [active])

  return (
    <div className="relative max-h-72 w-full">
      <video
        ref={videoRef}
        src={src}
        controls
        className="max-h-72 w-full object-contain"
        onLoadedMetadata={(e) => {
          onLoadedMetadata?.(e.currentTarget.duration)
          computeRect()
        }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
      />
      {rect && boxes.length > 0 && (
        <div
          className="pointer-events-none absolute"
          style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}
        >
          <svg
            className="h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {boxes.map((b, i) => (
              <g key={i}>
                <rect
                  x={b.x * 100}
                  y={b.y * 100}
                  width={b.w * 100}
                  height={b.h * 100}
                  fill="none"
                  stroke="#c1440e"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={b.x * 100 + 0.5}
                  y={Math.max(b.y * 100 - 1, 3)}
                  fill="#c1440e"
                  fontSize={4}
                  fontWeight={700}
                >
                  {b.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
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
                <FrameThumb thumb={f.thumb} index={f.index} verdicts={f.verdicts} />
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

// Large, labeled gallery of frames with boxes. No longer rendered — the video
// overlay (VideoWithBoxes) is the primary way boxes are shown — but kept for
// possible reuse elsewhere.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DetectionsGallery({
  frames,
  groundingModel,
}: {
  frames: FrameResult[]
  groundingModel?: string | null
}) {
  const withBoxes = frames.filter((f) =>
    f.verdicts.some((v) => (v.objects ?? []).some((o) => (o.boxes ?? []).length > 0)),
  )
  if (withBoxes.length === 0) return null
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        Detections
        {groundingModel && (
          <Badge variant="outline" className="gap-1 whitespace-nowrap font-normal">
            <ShieldCheck className="size-3" /> {groundingModel}
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {withBoxes.map((f) => {
          const labels = Array.from(
            new Set(
              f.verdicts.flatMap((v) => (v.objects ?? []).map((o) => o.phrase)),
            ),
          )
          return (
            <div key={f.index} className="flex flex-col gap-1">
              <FrameThumb thumb={f.thumb} index={f.index} verdicts={f.verdicts} size="large" />
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span className="tabular-nums">{f.t_sec}s</span>
                {labels.map((l) => (
                  <Badge key={l} variant="secondary" className="font-normal">
                    {l}
                  </Badge>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
