// Typed client for the automation/ service (PLAN.md §Data contracts).
// Every call is best-effort: callers fall back to local state when the
// backend is unreachable, so the dashboard always demos.

import type { AppEvent, Run, Workflow } from './types'

export const AUTOMATION_URL = import.meta.env.VITE_AUTOMATION_URL as
  | string
  | undefined

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

export const api = {
  configured: () => Boolean(AUTOMATION_URL),

  health: () => req<{ ok: boolean }>('/health'),

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
