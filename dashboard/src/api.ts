// Typed client for the automation/ service (PLAN.md §Data contracts).
// Every call is best-effort: callers fall back to local state when the
// backend is unreachable, so the dashboard always demos.

import type {
  AppEvent,
  CameraPayload,
  CameraState,
  DiscoverResponse,
  DiscoveredCamera,
  ResolveCameraRequest,
  ResolveCameraResponse,
  Run,
  Workflow,
  AgentFeed,
} from './types'

export const AUTOMATION_URL = import.meta.env.VITE_AUTOMATION_URL as
  | string
  | undefined

// The perception/ camera-control + detect API (mirrors Testing.tsx). Always
// has a localhost default so camera calls are best-effort, not gated on config.
export const PERCEPTION_URL =
  (import.meta.env.VITE_PERCEPTION_URL as string | undefined) ?? 'http://localhost:8008'

const TIMEOUT_MS = 3000

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  if (!AUTOMATION_URL) throw new ApiError('VITE_AUTOMATION_URL not set')
  return request<T>(AUTOMATION_URL, path, init, timeoutMs)
}

// Same best-effort/timeout style as `req`, but pointed at the perception base.
// `timeoutMs` overrides the default fetch timeout for slow calls (e.g. discovery).
async function preq<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  return request<T>(PERCEPTION_URL, path, init, timeoutMs)
}

async function request<T>(
  base: string,
  path: string,
  init?: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(
      `${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 200)}`,
      res.status,
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface LiveCameraStatus {
  camera_id: string
  zone: string
  source: string
  fps: number
  mode: 'discover' | 'targeted'
  running: boolean
  started_at: string
  error: string | null
}

export interface BackendStatus {
  h_agent: { mode: string; key_present: boolean; region: string }
  composio: {
    configured: boolean
    key_present: boolean
    execution_ready: boolean
    toolkits: { slack: boolean; googlesheets: boolean; googledrive: boolean }
    reason: string | null
    checked_at: string
  }
  gradium: { configured: boolean }
  nemoclaw: { url: string; active: boolean }
  counts: { events: number; workflows: number; runs: number }
}

export interface ComposioTool {
  slug: string
  name: string
  description: string
  logo?: string | null
  categories: string[]
  tools_count: number
  no_auth: boolean
}

export const api = {
  configured: () => Boolean(AUTOMATION_URL),

  health: () => req<{ ok: boolean }>('/health'),
  status: (refresh = false) => req<BackendStatus>(`/status${refresh ? '?refresh=1' : ''}`),

  // Start a Composio OAuth link for a toolkit (slack | googlesheets | googledrive | any slug).
  // Returns the URL the user opens to authorize; the account then shows in /status.
  connectComposio: (toolkit: string) =>
    req<{ toolkit: string; user_id: string; redirect_url: string; connection_id: string | null }>(
      `/integrations/composio/${toolkit}/connect`,
      { method: 'POST' },
      15_000,
    ),

  // The full Composio toolkit catalog for the Add-integration browser.
  composioCatalog: () =>
    req<{ toolkits: ComposioTool[] }>('/integrations/composio/catalog', undefined, 20_000),

  // events
  listEvents: (limit = 50) => req<AppEvent[]>(`/events?limit=${limit}`),
  postEvent: (event: AppEvent) =>
    req<{ accepted: boolean; runs_started: string[] }>('/events', {
      method: 'POST',
      body: JSON.stringify(event),
    }),

  // workflows
  listWorkflows: () => req<Workflow[]>('/workflows'),
  // NL → draft workflow (not saved). LLM call, so allow a long timeout.
  generateWorkflow: (description: string) =>
    req<Workflow & { _valid?: boolean; _validation_error?: string }>(
      '/generate_workflow',
      { method: 'POST', body: JSON.stringify({ description }) },
      90_000,
    ),
  createWorkflow: (wf: Omit<Workflow, 'id'> & { id?: string }) =>
    req<Workflow>('/workflows', { method: 'POST', body: JSON.stringify(wf) }),
  updateWorkflow: (id: string, wf: Workflow) =>
    req<Workflow>(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(wf) }),
  deleteWorkflow: (id: string) =>
    req<void>(`/workflows/${id}`, { method: 'DELETE' }),
  testWorkflow: (id: string) =>
    req<{ accepted: boolean; run_id: string }>(`/workflows/${id}/test`, {
      method: 'POST',
    }),

  // runs
  listRuns: (limit = 50) => req<Run[]>(`/runs?limit=${limit}`),
  getRun: (id: string) => req<Run>(`/runs/${id}`),

  // live agent view — the agent's actual movements for an H session, proxied
  // by the automation service so the browser can render screenshots + actions.
  agentFeed: (sessionId: string) =>
    req<AgentFeed>(`/agent/sessions/${encodeURIComponent(sessionId)}/events`, undefined, 15000),
  // Absolute URL for a proxied screenshot path returned in an AgentFeed.
  agentScreenshotUrl: (path: string) =>
    AUTOMATION_URL ? `${AUTOMATION_URL}${path}` : path,

  // live cameras (perception service)
  perceptionConfigured: () => Boolean(PERCEPTION_URL),
  liveStart: (body: {
    camera_id: string
    source: string
    zone: string
    fps?: number
    events?: string
    min_confidence?: number
  }) =>
    preq<{ ok: boolean; grounding: boolean; live: LiveCameraStatus }>(
      '/live/start',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  liveStop: (camera_id: string) =>
    preq<{ ok: boolean; live: LiveCameraStatus }>('/live/stop', {
      method: 'POST',
      body: JSON.stringify({ camera_id }),
    }),
  liveStatus: () =>
    preq<{ grounding: boolean; cameras: LiveCameraStatus[] }>('/live/status'),
}

// --- perception camera-control client (best-effort, base = PERCEPTION_URL) ---

export const listCameras = () => preq<CameraState[]>('/cameras')
export const createCamera = (payload: CameraPayload) =>
  // Routing through go2rtc means the server can spend up to ~6s on
  // gateway.available() + gateway.register(), so the client timeout must
  // comfortably exceed that budget or a phantom local camera gets added.
  preq<CameraState>('/cameras', { method: 'POST', body: JSON.stringify(payload) }, 10000)
export const getCamera = (id: string) => preq<CameraState>(`/cameras/${id}`)
export const pauseCamera = (id: string) =>
  preq<CameraState>(`/cameras/${id}/pause`, { method: 'POST' })
export const resumeCamera = (id: string) =>
  preq<CameraState>(`/cameras/${id}/resume`, { method: 'POST' })
export const deleteCamera = (id: string) =>
  preq<void>(`/cameras/${id}`, { method: 'DELETE' })

// URL of the latest sampled JPEG frame — used for the live camera preview.
export const cameraSnapshotUrl = (id: string) => `${PERCEPTION_URL}/cameras/${id}/latest.jpg`

// --- ONVIF discovery (best-effort, base = PERCEPTION_URL) -------------------

// Scan the local network for ONVIF cameras. Best-effort like the other
// perception calls: on any failure (backend down, timeout) return [] so the
// manual add flow stays fully usable.
export const discoverCameras = async (timeoutSec = 4): Promise<DiscoveredCamera[]> => {
  try {
    // The backend blocks for ~timeoutSec running WS-Discovery, so the client
    // fetch timeout must exceed that window (scan + network/parse buffer).
    const res = await preq<DiscoverResponse>(
      `/discover?timeout=${timeoutSec}`,
      undefined,
      timeoutSec * 1000 + 4000,
    )
    return res.cameras ?? []
  } catch {
    return []
  }
}

// Resolve a discovered camera + credentials into an rtsp URL. Unlike discovery
// this is allowed to throw (400 on bad creds / unreachable) so the dialog can
// surface the error to the user.
export const resolveCamera = (body: ResolveCameraRequest) =>
  preq<ResolveCameraResponse>('/discover/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
  })
