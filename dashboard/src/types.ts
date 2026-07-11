// Mirrors shared/event_schema.json plus dashboard-only config entities.

// Event types are open-ended: the perception model names them semantically
// (snake_case slugs like 'spill', 'blocked_exit', 'missing_ppe'), so this is a
// plain string rather than a fixed union. The dashboard derives a label, color
// and icon for any type at runtime (see constants.ts `eventMeta`).
export type EventType = string

export type CameraSource = 'webcam' | 'rtsp' | 'file' | 'hls'
export type CameraStatus = 'live' | 'connecting' | 'offline'

export interface Camera {
  id: string
  name: string
  zone: string
  source: CameraSource
  url?: string
  status: CameraStatus
  fps: number
  detects: EventType[]
  eventsToday: number
}

export type IntegrationCategory =
  | 'agent'
  | 'storage'
  | 'messaging'
  | 'voice'
  | 'custom'

export type IntegrationStatus = 'connected' | 'disconnected'
export type AuthType = 'oauth' | 'apikey' | 'webhook'

export interface Integration {
  id: string
  name: string
  category: IntegrationCategory
  status: IntegrationStatus
  description: string
  authType: AuthType
  accountLabel?: string
}

export interface AppEvent {
  event_id: string
  event_type: EventType
  timestamp: string
  confidence: number
  location: string
  snapshot_url?: string
  payload?: Record<string, unknown>
}

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: EventType
  zone?: string
  minConfidence: number
  actions: string[] // integration ids
  runs: number
}

export interface ActivityItem {
  id: string
  time: string
  automation: string
  event_type: EventType
  status: 'running' | 'done' | 'failed'
  detail: string
}

// --- Backend contracts (shared/workflow_schema.json + PLAN.md §Run) --------

export type StepType = 'h_agent' | 'composio' | 'condition' | 'voice' | 'mcp'

export interface WorkflowTrigger {
  event_type: EventType
  zone?: string
  min_confidence: number
  cooldown_sec: number
}

export interface WorkflowStep {
  id: string
  type: StepType
  config: Record<string, unknown>
}

export interface Workflow {
  id: string
  name: string
  enabled: boolean
  trigger: WorkflowTrigger
  steps: WorkflowStep[]
}

export type RunStatus = 'running' | 'done' | 'failed'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface RunStep {
  id: string
  type: StepType
  status: StepStatus
  started_at?: string
  finished_at?: string
  output?: Record<string, unknown>
}

export interface Run {
  id: string
  workflow_id: string
  workflow_name?: string
  event: AppEvent
  status: RunStatus
  started_at?: string
  finished_at?: string
  steps: RunStep[]
}
