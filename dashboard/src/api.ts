// Typed client for the automation/ service (PLAN.md §Data contracts).
// Every call is best-effort: callers fall back to local state when the
// backend is unreachable, so the dashboard always demos.

import type { AppEvent, Run, Workflow } from './types'

export const AUTOMATION_URL = import.meta.env.VITE_AUTOMATION_URL as
  | string
  | undefined

export const PERCEPTION_URL =
  (import.meta.env.VITE_PERCEPTION_URL as string | undefined) ??
  'http://localhost:8008'

const TIMEOUT_MS = 3000

class ApiError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  if (!AUTOMATION_URL) throw new ApiError('VITE_AUTOMATION_URL not set')
  const res = await fetch(`${AUTOMATION_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(`${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// Perception service (the VLM + grounding detect / live-camera control API).
// Separate base URL because it runs as its own uvicorn app on another port.
async function preq<T>(path: string, init?: RequestInit): Promise<T> {
  if (!PERCEPTION_URL) throw new ApiError('VITE_PERCEPTION_URL not set')
  const res = await fetch(`${PERCEPTION_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(`${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 200)}`)
  }
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
  composio: { configured: boolean }
  gradium: { configured: boolean }
  nemoclaw: { url: string; active: boolean }
  counts: { events: number; workflows: number; runs: number }
}

export const api = {
  configured: () => Boolean(AUTOMATION_URL),

  health: () => req<{ ok: boolean }>('/health'),
  status: () => req<BackendStatus>('/status'),

  // events
  listEvents: (limit = 50) => req<AppEvent[]>(`/events?limit=${limit}`),
  postEvent: (event: AppEvent) =>
    req<{ accepted: boolean; runs_started: string[] }>('/events', {
      method: 'POST',
      body: JSON.stringify(event),
    }),

  // workflows
  listWorkflows: () => req<Workflow[]>('/workflows'),
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
