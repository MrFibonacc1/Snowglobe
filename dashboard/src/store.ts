import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityItem,
  AppEvent,
  Automation,
  Camera,
  CameraPayload,
  CameraSource,
  CameraState,
  EventType,
  Integration,
  Run,
  RunStep,
  Workflow,
} from './types'
import { SUGGESTED_EVENT_TYPES, eventMeta } from './constants'
import {
  api,
  createCamera,
  deleteCamera as apiDeleteCamera,
  listCameras,
  pauseCamera as apiPauseCamera,
  resumeCamera as apiResumeCamera,
} from './api'
import {
  integrationCatalog,
  seedAutomations,
  seedCameras,
  seedEvents,
  seedWorkflows,
} from './mockData'

const KEY = 'snowglobe.state.v1'
const TESTING_SESSION_KEY = 'snowglobe.testing.session.v1'

interface PersistedState {
  cameras: Camera[]
  integrations: Integration[]
  automations: Automation[]
  events: AppEvent[]
  activity: ActivityItem[]
  workflows: Workflow[]
  testingRuns: Run[]
  testingRun: TestingRunState | null
}

interface TestingRunState {
  id: string
  running: boolean
  kind: 'image' | 'video'
  fileName: string
  startedAt: string
  zone?: string
  error?: string
}

type TestingResult = unknown
type TestingCompletion = {
  id?: string
  error?: string
  payload?: Record<string, unknown> | null
  detectedEvents?: AppEvent[]
  zone?: string
  runIds?: string[]
}

const LOCAL_RUN_KEEP_LIMIT = 20
const SAFE_TESTING_RUN_LIMIT = 50

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>
      const seededEvents = ['evt_1', 'evt_2', 'evt_3', 'evt_4']
      // workflows was added later — backfill for older persisted state.
      const hydrated = { ...blank(), ...parsed } as PersistedState
      const testingRuns = normalizeTestingRuns(hydrated.testingRuns)
      const testingRun = normalizeTestingRun(hydrated.testingRun)
      const events =
        hydrated.events.length === 4 &&
        hydrated.events.every((event, idx) => event.event_id === seededEvents[idx])
          ? []
          : hydrated.events
      return {
        ...hydrated,
        testingRuns,
        testingRun,
        events,
        cameras: rebuildEventsToday(hydrated.cameras, events),
      }
    }
  } catch {
    /* ignore corrupt state */
  }
  return blank()
}

function blank(): PersistedState {
  return {
    cameras: seedCameras,
    integrations: integrationCatalog,
    automations: seedAutomations,
    events: seedEvents,
    activity: [],
    workflows: seedWorkflows,
    testingRuns: [],
    testingRun: null,
  }
}

// Small non-crypto id. Suffix keeps ids unique within a render tick.
let seq = 0
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`
const DAY_MS = 24 * 60 * 60 * 1000

function rebuildEventsToday(cameras: Camera[], events: AppEvent[]) {
  const cutoff = Date.now() - DAY_MS
  const counts = new Map<string, number>()

  for (const e of events) {
    const ts = Date.parse(e.timestamp)
    if (Number.isNaN(ts) || ts < cutoff) continue
    counts.set(e.location, (counts.get(e.location) ?? 0) + 1)
  }

  return cameras.map((camera) =>
    // Backend-managed cameras get their count from mergeCameraStates (the
    // backend's events_emitted is the single source of truth); only recompute
    // for local/mock cameras.
    camera.events_emitted !== undefined
      ? camera
      : { ...camera, eventsToday: counts.get(camera.zone) ?? 0 },
  )
}

function normalizeTestingRun(input: unknown): TestingRunState | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<TestingRunState>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.startedAt !== 'string' ||
    !candidate.id ||
    !candidate.startedAt
  ) {
    return null
  }
  if (candidate.running !== true && candidate.running !== false) return null
  if (candidate.kind !== 'image' && candidate.kind !== 'video') return null
  if (typeof candidate.fileName !== 'string' || !candidate.fileName) return null
  return {
    ...candidate,
    zone: candidate.zone || 'zone_a',
  } as TestingRunState
}

function normalizeRun(input: unknown): Run | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<Run>
  if (!candidate.event || typeof candidate.event !== 'object') return null
  const event = candidate.event as Partial<AppEvent>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.workflow_id !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof event.event_id !== 'string' ||
    typeof event.event_type !== 'string' ||
    typeof event.timestamp !== 'string' ||
    typeof event.location !== 'string' ||
    typeof event.confidence !== 'number' ||
    !Array.isArray(candidate.steps)
  ) {
    return null
  }
  return candidate as Run
}

function normalizeTestingRuns(input: unknown): Run[] {
  if (!Array.isArray(input)) return []
  return input
    .map(normalizeRun)
    .filter((run): run is Run => run !== null)
    .sort((a, b) => {
      const ta = new Date(a.started_at ?? a.event.timestamp).getTime()
      const tb = new Date(b.started_at ?? b.event.timestamp).getTime()
      return tb - ta
    })
    .slice(0, SAFE_TESTING_RUN_LIMIT)
}

// What the "Connect camera" dialog collects, before an id/status is assigned.
export interface NewCamera {
  name: string
  zone: string
  source: CameraSource
  url?: string
  fps: number
  detects: EventType[]
}

// The perception service samples an rtsp/hls feed by its URL; for a local
// webcam or uploaded file the source-type name is the source string.
function sourceString(c: NewCamera): string {
  return (c.source === 'rtsp' || c.source === 'hls') && c.url ? c.url : c.source
}

// Map a backend CameraState onto a dashboard Camera, preserving the UI-only
// `source`/`url` (the backend collapses these into one free-form string).
function backendToCamera(st: CameraState, source: CameraSource, url?: string): Camera {
  return {
    id: st.id,
    name: st.name,
    zone: st.zone,
    source,
    url,
    status: st.status,
    fps: st.fps,
    detects: st.events ?? [],
    eventsToday: st.events_emitted ?? 0,
    last_frame_at: st.last_frame_at ?? null,
    frames_sampled: st.frames_sampled,
    events_emitted: st.events_emitted,
    error: st.error ?? null,
  }
}

export function useStore() {
  const initialState = load()
  const [state, setState] = useState<PersistedState>(initialState)
  const [live, setLive] = useState(false)
  // null = unknown, true/false = last known backend reachability.
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [testingRuns, setTestingRuns] = useState<Run[]>(() => initialState.testingRuns)
  const [runs, setRuns] = useState<Run[]>([])
  const [testingRun, setTestingRun] = useState<TestingRunState | null>(
    () => initialState.testingRun,
  )
  const [testingError, setTestingError] = useState<string | null>(null)
  const [testingResult, setTestingResult] = useState<TestingResult | null>(null)
  const [testingFile, setTestingFile] = useState<File | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const backendRef = useRef(backendOnline)
  backendRef.current = backendOnline

  useEffect(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...state,
          testingRuns,
          testingRun,
        }),
      )
    } catch {
      /* quota / private mode — non-fatal */
    }
  }, [state, testingRuns, testingRun])

  const markBackend = useCallback((online: boolean) => {
    if (backendRef.current !== online) setBackendOnline(online)
  }, [])

  const mergeRuns = useCallback((backendRuns: Run[], localRuns: Run[]) => {
    const remoteIds = new Set(backendRuns.map((run) => run.id))
    const merged = [...backendRuns, ...localRuns.filter((r) => !remoteIds.has(r.id))]
    return merged
      .sort((a, b) => {
        const ta = new Date(a.started_at ?? a.event.timestamp).getTime()
        const tb = new Date(b.started_at ?? b.event.timestamp).getTime()
        return tb - ta
      })
      .slice(0, 50)
  }, [])

  const buildTestingRunCard = useCallback(
    ({
      runId,
      kind,
      fileName,
      zone,
    }: {
      runId: string
      kind: 'image' | 'video'
      fileName: string
      zone?: string
    }) => {
      const startedAt = new Date().toISOString()
      const eventType = 'testing_started'
      return {
        id: runId,
        workflow_id: 'perception_test',
        workflow_name: 'Perception test',
        event: {
          event_id: uid('evt'),
          event_type: eventType,
          timestamp: startedAt,
          confidence: 1,
          location: zone || 'zone_a',
          payload: {
            file: fileName,
            kind,
          },
        },
        status: 'running' as const,
        started_at: startedAt,
        steps: [
          {
            id: uid('step'),
            type: 'mcp',
            status: 'running',
            started_at: startedAt,
            output: {
              tool: 'perception_test',
              result: `Analyzing ${fileName}...`,
            },
          } as RunStep,
        ],
      } as Run
    },
    [],
  )

  const upsertTestingRun = useCallback(
    (run: Run) => {
      setTestingRuns((prev) => {
        const updated = [...prev]
        const idx = updated.findIndex((r) => r.id === run.id)
        if (idx >= 0) {
          updated[idx] = run
        } else {
          updated.unshift(run)
        }
        const next = updated.slice(0, LOCAL_RUN_KEEP_LIMIT)
        setRuns((currentRuns) => {
          const backendOnly = currentRuns.filter((r) => !prev.some((local) => local.id === r.id))
          return mergeRuns(backendOnly, next)
        })
        return next
      })
    },
    [mergeRuns],
  )

  const hydrateRuns = useCallback((upstream: Run[]) => {
    setRuns(mergeRuns(upstream, testingRuns))
  }, [testingRuns, mergeRuns])

  const pushEvent = useCallback((event: AppEvent) => {
    setState((s) => {
      const events = [event, ...s.events].slice(0, 200)
      const nextCameras = rebuildEventsToday(s.cameras, events)
      // Fire any enabled automation matching this event (offline simulation only).
      const activity: ActivityItem[] = []
      const automations = s.automations.map((a) => {
        const match =
          a.enabled &&
          (a.trigger === '*' || a.trigger === event.event_type) &&
          event.confidence >= a.minConfidence &&
          (!a.zone || a.zone === event.location)
        if (!match) return a
        activity.push({
          id: uid('act'),
          time: event.timestamp,
          automation: a.name,
          event_type: event.event_type,
          status: 'running',
          detail: `${eventMeta(event.event_type).label} in ${event.location} → ${a.actions.length} action(s)`,
        })
        return { ...a, runs: a.runs + 1 }
      })
      return {
        ...s,
        cameras: nextCameras,
        events,
        automations,
        activity: [...activity, ...s.activity].slice(0, 100),
      }
    })
  }, [])

  const mergeEvents = useCallback((incoming: AppEvent[]) => {
    setState((s) => {
      const known = new Set(s.events.map((e) => e.event_id))
      const fresh = incoming.filter((e) => !known.has(e.event_id))
      if (fresh.length === 0) return s
      const nextEvents = [...fresh, ...s.events].slice(0, 200)
      const cameras = rebuildEventsToday(s.cameras, nextEvents)
      return {
        ...s,
        cameras,
        events: nextEvents,
      }
    })
  }, [])

  const ingestEvents = useCallback((incoming: AppEvent[]) => {
    mergeEvents(incoming)
  }, [mergeEvents])


  const refreshRuns = useCallback(async () => {
    if (!api.configured()) return []
    try {
      const latestRuns = await api.listRuns(30)
      markBackend(true)
      hydrateRuns(latestRuns)
      return latestRuns
    } catch {
      markBackend(false)
      return []
    }
  }, [hydrateRuns, markBackend])

  const startTestingRun = useCallback(
    (params: { kind: 'image' | 'video'; fileName: string; zone?: string }) => {
      const runId = uid('testrun')
      const nextRun = buildTestingRunCard({
        runId,
        kind: params.kind,
        fileName: params.fileName,
        zone: params.zone,
      })
      const startedAt = nextRun.started_at ?? new Date().toISOString()
      setTestingRun({
        id: runId,
        running: true,
        kind: params.kind,
        fileName: params.fileName,
        zone: params.zone,
        startedAt,
      })
      upsertTestingRun(nextRun)
      setTestingResult(null)
      setTestingError(null)
      return runId
    },
    [buildTestingRunCard, upsertTestingRun],
  )

  const finishTestingRun = useCallback(
    (params: TestingCompletion = {}) => {
      const runId = params.id ?? testingRun?.id
      const runError = params.error
      const payload = params.payload
      const detectedEvents = params.detectedEvents ?? []
      const file = typeof payload?.file === 'string' ? payload.file : testingRun?.fileName || 'upload'
      const zone = params.zone || testingRun?.zone || 'zone_a'
      const kind = testingRun?.kind ?? 'image'
      const confidence = detectedEvents.length
        ? Math.max(...detectedEvents.map((event) => event.confidence))
        : 0.75
      const summaryLine: string[] = []
      summaryLine.push(`File: ${file}`)
      summaryLine.push(`Mode: ${kind}`)
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>
        if (typeof p.frames_analyzed === 'number') summaryLine.push(`Frames analyzed: ${p.frames_analyzed}`)
        if (typeof p.mock === 'boolean')
          summaryLine.push(`Model: ${p.mock ? 'mock' : typeof p.model === 'string' ? p.model : 'unknown'}`)
        if (typeof p.mode === 'string') summaryLine.push(`Detection mode: ${p.mode}`)
      }
      if (runError) {
        summaryLine.push(`Result: failed - ${runError}`)
      } else if (detectedEvents.length > 0) {
        summaryLine.push(`Detected ${detectedEvents.length} event(s).`)
        summaryLine.push(`Top events: ${detectedEvents.slice(0, 3).map((e) => e.event_type).join(', ')}`)
      } else {
        summaryLine.push('No actionable events detected.')
      }
      if (params.runIds?.length) {
        summaryLine.push(`Backend run IDs: ${params.runIds.join(', ')}`)
      }
      const runStatus: Run['status'] = runError ? 'failed' : 'done'

      if (runId) {
        const existing = testingRuns.find((run) => run.id === runId)
        if (existing) {
          const step: RunStep = {
            ...(existing.steps[0] ??
              ({
                id: uid('step'),
                type: 'mcp',
                status: 'running',
                started_at: new Date().toISOString(),
                output: {},
              } as RunStep)),
            status: runStatus,
            finished_at: new Date().toISOString(),
            output: {
              ...(existing.steps[0]?.output ?? {}),
              tool: 'perception_test',
              result: summaryLine.join('\n'),
              backend_runs: params.runIds ?? [],
              detected_events: detectedEvents.length,
            },
          }
          upsertTestingRun({
            ...existing,
            status: runStatus,
            finished_at: new Date().toISOString(),
            event: {
              ...existing.event,
              event_type: detectedEvents[0]?.event_type ?? existing.event.event_type,
              timestamp: new Date().toISOString(),
              confidence,
              location: zone,
              payload: {
                ...((existing.event.payload as Record<string, unknown>) ?? {}),
                file,
                kind,
                detected_events: detectedEvents.length,
                backend_runs: params.runIds ?? [],
              },
            },
            steps: [step],
          })
        }
      }

      setTestingRun((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              error: runError,
            }
          : prev,
      )
      if (runError) setTestingError(runError)
      else setTestingError(null)
    },
    [testingRun, testingRuns, upsertTestingRun],
  )

  // Merge live camera state from the perception service into any cameras we
  // already show (matched by id). Leaves seeded/offline demo cameras untouched.
  const mergeCameraStates = useCallback((states: CameraState[]) => {
    if (states.length === 0) return
    setState((s) => {
      const byId = new Map(states.map((st) => [st.id, st]))
      const seen = new Set<string>()
      let touched = false
      const cameras = s.cameras.map((c) => {
        const st = byId.get(c.id)
        if (!st) return c
        seen.add(c.id)
        touched = true
        return {
          ...c,
          status: st.status,
          fps: st.fps,
          detects: st.events ?? c.detects,
          eventsToday: st.events_emitted ?? c.eventsToday,
          last_frame_at: st.last_frame_at ?? null,
          frames_sampled: st.frames_sampled,
          events_emitted: st.events_emitted,
          error: st.error ?? null,
        }
      })
      // Add cameras the backend returns that aren't in local state yet (created
      // elsewhere / in a prior session), without clobbering matched cameras.
      const added = states
        .filter((st) => !seen.has(st.id))
        .map((st) => backendToCamera(st, 'rtsp'))
      if (added.length > 0) touched = true
      return touched ? { ...s, cameras: [...cameras, ...added] } : s
    })
  }, [])

  // On mount (and whenever the backend is configured), hydrate workflows from
  // the service so the builder edits real data. Also hydrate events/runs so
  // the dashboard starts from live data instead of seeded placeholders.
  useEffect(() => {
    if (!api.configured()) return
    let cancelled = false
    api
      .listWorkflows()
      .then((wfs) => {
        if (cancelled) return
        markBackend(true)
        setState((s) => ({ ...s, workflows: wfs }))
      })
      .catch(() => markBackend(false))
    api
      .listEvents(100)
      .then((events) => {
        if (cancelled) return
        setState((s) => ({
          ...s,
          events,
          cameras: rebuildEventsToday(s.cameras, events),
        }))
      })
      .catch(() => markBackend(false))
    api
      .listRuns(30)
      .then((latestRuns) => {
        if (cancelled) return
        hydrateRuns(latestRuns)
      })
      .catch(() => markBackend(false))
    return () => {
      cancelled = true
    }
  }, [markBackend, hydrateRuns])

  // Live loop: poll events + runs from the backend; simulate if unreachable.
  useEffect(() => {
    if (!live) return
    let stopped = false

    async function tick() {
      if (!api.configured()) return simulate()
      try {
        const [events, latestRuns] = await Promise.all([
          api.listEvents(10),
          api.listRuns(30),
        ])
        if (stopped) return
        markBackend(true)
        mergeEvents(events)
        hydrateRuns(latestRuns)
      } catch {
        markBackend(false)
        simulate() // backend unreachable — keep the demo alive
      }
    }

    function simulate() {
      const type = SUGGESTED_EVENT_TYPES[Math.floor(seededRandom() * SUGGESTED_EVENT_TYPES.length)]
      const zones = stateRef.current.cameras
        .filter((c) => c.status === 'live' && c.detects.includes(type))
        .map((c) => c.zone)
      if (zones.length === 0) return
      const location = zones[Math.floor(seededRandom() * zones.length)]
      pushEvent({
        event_id: uid('evt'),
        event_type: type,
        timestamp: new Date().toISOString(),
        confidence: Number((0.65 + seededRandom() * 0.34).toFixed(2)),
        location,
        payload: /count|traffic|crowd|queue/.test(type)
          ? { count: Math.floor(5 + seededRandom() * 40) }
          : { detail: 'Detected by the perception model' },
      })
    }

    tick()
    const t = setInterval(() => {
      if (!stopped) tick()
    }, 2500)
    return () => {
      stopped = true
      clearInterval(t)
    }
    }, [live, pushEvent, mergeEvents, markBackend, hydrateRuns])

  // Camera state comes from the perception service, which is independent of the
  // automation backend and the global `live` toggle — the Cameras page is always
  // visible, so poll it on its own interval so a `connecting` camera can advance
  // to `live` without the user flipping Live.
  useEffect(() => {
    let stopped = false
    let inFlight = false

    async function pollCameras() {
      if (inFlight) return // don't stack overlapping polls behind a slow request
      inFlight = true
      try {
        const cams = await listCameras()
        if (!stopped) mergeCameraStates(cams)
      } catch {
        /* perception offline — keep local camera state */
      } finally {
        inFlight = false
      }
    }

    pollCameras()
    const t = setInterval(pollCameras, 2500)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [mergeCameraStates])

  // --- camera mutations --------------------------------------------------

  // Connect a camera via the perception service. Best-effort: on any failure we
  // fall back to a local 'connecting' camera so the demo still works.
  const connectCamera = useCallback(
    async (input: NewCamera): Promise<{ online: boolean }> => {
      const payload: CameraPayload = {
        name: input.name,
        zone: input.zone,
        source: sourceString(input),
        fps: input.fps,
        events: input.detects,
      }
      try {
        const st = await createCamera(payload)
        markBackend(true)
        const camera = backendToCamera(st, input.source, input.url)
        setState((s) => ({ ...s, cameras: [...s.cameras, camera] }))
        return { online: true }
      } catch {
        markBackend(false)
        const camera: Camera = { ...input, id: uid('cam'), status: 'connecting', eventsToday: 0 }
        setState((s) => ({ ...s, cameras: [...s.cameras, camera] }))
        return { online: false }
      }
    },
    [markBackend],
  )

  const removeCamera = useCallback(
    async (id: string) => {
      // Capture the camera so a failed DELETE can be reverted — otherwise it
      // vanishes from the UI while it keeps running on the backend.
      const removed = stateRef.current.cameras.find((c) => c.id === id)
      setState((s) => ({ ...s, cameras: s.cameras.filter((c) => c.id !== id) }))
      try {
        await apiDeleteCamera(id)
        markBackend(true)
      } catch {
        markBackend(false)
        // Restore it (keep it visible) so it doesn't orphan on the backend.
        if (removed) {
          setState((s) =>
            s.cameras.some((c) => c.id === id)
              ? s
              : { ...s, cameras: [...s.cameras, removed] },
          )
        }
      }
    },
    [markBackend],
  )

  // Reconcile a camera against the state the backend returns (or optimistically
  // set `fallback` when the perception service is unreachable).
  const applyCameraMutation = useCallback(
    async (id: string, call: (id: string) => Promise<CameraState>, fallback: Camera['status']) => {
      // Remember the pre-mutation status so a failed call can be reverted
      // rather than left stuck on the optimistic value.
      const prevStatus = stateRef.current.cameras.find((c) => c.id === id)?.status
      setState((s) => ({
        ...s,
        cameras: s.cameras.map((c) => (c.id === id ? { ...c, status: fallback } : c)),
      }))
      try {
        const st = await call(id)
        markBackend(true)
        setState((s) => ({
          ...s,
          cameras: s.cameras.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: st.status,
                  fps: st.fps,
                  eventsToday: st.events_emitted ?? c.eventsToday,
                  last_frame_at: st.last_frame_at ?? null,
                  frames_sampled: st.frames_sampled,
                  events_emitted: st.events_emitted,
                  error: st.error ?? null,
                }
              : c,
          ),
        }))
      } catch {
        markBackend(false)
        // Revert the optimistic status so pause/resume doesn't stick on failure.
        if (prevStatus !== undefined) {
          setState((s) => ({
            ...s,
            cameras: s.cameras.map((c) => (c.id === id ? { ...c, status: prevStatus } : c)),
          }))
        }
      }
    },
    [markBackend],
  )

  const pauseCamera = useCallback(
    (id: string) => applyCameraMutation(id, apiPauseCamera, 'paused'),
    [applyCameraMutation],
  )

  const resumeCamera = useCallback(
    (id: string) => applyCameraMutation(id, apiResumeCamera, 'live'),
    [applyCameraMutation],
  )

  const setIntegrationStatus = useCallback(
    (id: string, status: Integration['status'], accountLabel?: string) => {
      setState((s) => ({
        ...s,
        integrations: s.integrations.map((i) =>
          i.id === id
            ? {
                ...i,
                status,
                accountLabel:
                  status === 'connected' ? accountLabel ?? i.accountLabel : undefined,
              }
            : i,
        ),
      }))
    },
    [],
  )

  const addIntegration = useCallback((i: Omit<Integration, 'id'>) => {
    setState((s) => ({
      ...s,
      integrations: [...s.integrations, { ...i, id: uid('int') }],
    }))
  }, [])

  // --- workflow mutations (backend-first, local fallback) ----------------

  const refreshWorkflows = useCallback(async () => {
    if (!api.configured()) return
    try {
      const wfs = await api.listWorkflows()
      markBackend(true)
      setState((s) => ({ ...s, workflows: wfs }))
    } catch {
      markBackend(false)
    }
  }, [markBackend])

  const saveWorkflow = useCallback(
    async (wf: Workflow, isNew: boolean) => {
      // Optimistic local update so the UI is responsive offline.
      setState((s) => {
        const exists = s.workflows.some((w) => w.id === wf.id)
        return {
          ...s,
          workflows: exists
            ? s.workflows.map((w) => (w.id === wf.id ? wf : w))
            : [...s.workflows, wf],
        }
      })
      if (!api.configured()) return
      try {
        const saved = isNew
          ? await api.createWorkflow(wf)
          : await api.updateWorkflow(wf.id, wf)
        markBackend(true)
        // Backend may assign/normalize the id — reconcile.
        setState((s) => ({
          ...s,
          workflows: s.workflows.map((w) => (w.id === wf.id ? saved : w)),
        }))
      } catch {
        markBackend(false)
      }
    },
    [markBackend],
  )

  const removeWorkflow = useCallback(
    async (id: string) => {
      setState((s) => ({ ...s, workflows: s.workflows.filter((w) => w.id !== id) }))
      if (!api.configured()) return
      try {
        await api.deleteWorkflow(id)
        markBackend(true)
      } catch {
        markBackend(false)
      }
    },
    [markBackend],
  )

  const toggleWorkflow = useCallback(
    (id: string) => {
      const wf = stateRef.current.workflows.find((w) => w.id === id)
      if (!wf) return
      saveWorkflow({ ...wf, enabled: !wf.enabled }, false)
    },
    [saveWorkflow],
  )

  const testWorkflow = useCallback(
    async (id: string): Promise<string | null> => {
      if (!api.configured()) return null
      try {
        const { run_id } = await api.testWorkflow(id)
        markBackend(true)
        // Pull the fresh run in immediately so the Runs view lights up.
        try {
          hydrateRuns(await api.listRuns(30))
        } catch {
          /* non-fatal */
        }
        return run_id
      } catch {
        markBackend(false)
        return null
      }
    },
    [markBackend, hydrateRuns],
  )

  // --- legacy automation mutations (kept for offline Automations UI) -----

  const addAutomation = useCallback((a: Omit<Automation, 'id' | 'runs'>) => {
    setState((s) => ({
      ...s,
      automations: [...s.automations, { ...a, id: uid('auto'), runs: 0 }],
    }))
  }, [])

  const toggleAutomation = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      automations: s.automations.map((a) =>
        a.id === id ? { ...a, enabled: !a.enabled } : a,
      ),
    }))
  }, [])

  const removeAutomation = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      automations: s.automations.filter((a) => a.id !== id),
    }))
  }, [])

  const resetDemo = useCallback(() => {
    localStorage.removeItem(KEY)
    localStorage.removeItem(TESTING_SESSION_KEY)
    setState(load())
    setRuns([])
    setTestingRuns([])
    setTestingRun(null)
    setTestingError(null)
    setTestingResult(null)
    setTestingFile(null)
  }, [])

  return {
    ...state,
    runs,
    live,
    setLive,
    backendOnline,
    connectCamera,
    removeCamera,
    pauseCamera,
    resumeCamera,
    ingestEvents,
    setIntegrationStatus,
    addIntegration,
    refreshWorkflows,
    saveWorkflow,
    removeWorkflow,
    toggleWorkflow,
    testWorkflow,
    addAutomation,
    testingFile,
    setTestingFile,
    refreshRuns,
    testingError,
    setTestingError,
    testingResult,
    setTestingResult,
    toggleAutomation,
    removeAutomation,
    testingRun,
    startTestingRun,
    finishTestingRun,
    resetDemo,
  }
}

export type Store = ReturnType<typeof useStore>

// Deterministic-ish PRNG so the simulation doesn't rely on Math.random being
// seeded; good enough to vary demo events.
let s0 = 0x9e3779b9
function seededRandom() {
  s0 ^= s0 << 13
  s0 ^= s0 >>> 17
  s0 ^= s0 << 5
  return ((s0 >>> 0) % 100000) / 100000
}
