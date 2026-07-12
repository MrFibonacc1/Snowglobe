// Typed client for the automation/ service (PLAN.md §Data contracts).
// Every call is best-effort: callers fall back to local state when the
// backend is unreachable, so the dashboard always demos.

import type { AppEvent, CameraPayload, CameraState, Run, Workflow } from './types'

export const AUTOMATION_URL = import.meta.env.VITE_AUTOMATION_URL as
  | string
  | undefined

// The perception/ camera-control + detect API (mirrors Testing.tsx). Always
// has a localhost default so camera calls are best-effort, not gated on config.
export const PERCEPTION_URL =
  (import.meta.env.VITE_PERCEPTION_URL as string | undefined) ?? 'http://localhost:8008'

const TIMEOUT_MS = 3000

class ApiError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  if (!AUTOMATION_URL) throw new ApiError('VITE_AUTOMATION_URL not set')
  return request<T>(AUTOMATION_URL, path, init)
}

// Same best-effort/timeout style as `req`, but pointed at the perception base.
async function preq<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(PERCEPTION_URL, path, init)
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
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
}

// --- perception camera-control client (best-effort, base = PERCEPTION_URL) ---

export const listCameras = () => preq<CameraState[]>('/cameras')
export const createCamera = (payload: CameraPayload) =>
  preq<CameraState>('/cameras', { method: 'POST', body: JSON.stringify(payload) })
export const getCamera = (id: string) => preq<CameraState>(`/cameras/${id}`)
export const pauseCamera = (id: string) =>
  preq<CameraState>(`/cameras/${id}/pause`, { method: 'POST' })
export const resumeCamera = (id: string) =>
  preq<CameraState>(`/cameras/${id}/resume`, { method: 'POST' })
export const deleteCamera = (id: string) =>
  preq<void>(`/cameras/${id}`, { method: 'DELETE' })

// URL of the latest sampled JPEG frame — used for the live camera preview.
export const cameraSnapshotUrl = (id: string) => `${PERCEPTION_URL}/cameras/${id}/latest.jpg`
