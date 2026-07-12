// Mirrors shared/event_schema.json plus dashboard-only config entities.

// Event types are open-ended: the perception model names them semantically
// (snake_case slugs like 'spill', 'blocked_exit', 'missing_ppe'), so this is a
// plain string rather than a fixed union. The dashboard derives a label, color
// and icon for any type at runtime (see constants.ts `eventMeta`).
export type EventType = string

export type CameraSource = 'webcam' | 'window' | 'screen' | 'rtsp' | 'file' | 'hls'
export type CameraStatus = 'live' | 'connecting' | 'paused' | 'offline' | 'error'

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
  // Backend perception-service fields (present once wired to a real camera).
  last_frame_at?: string | null
  frames_sampled?: number
  events_emitted?: number
  error?: string | null
  // Original source before go2rtc normalization (backend-supplied).
  origin?: string | null
}

// Camera state as returned by the perception camera-control API. `source` is a
// free-form string (a stream URL or the source-type name) and detections live
// under `events` — mapped to the dashboard `Camera` in the store/api layer.
export interface CameraState {
  id: string
  name: string
  source: string
  zone: string
  fps: number
  events: string[]
  mock: boolean
  status: CameraStatus
  last_frame_at?: string | null
  frames_sampled?: number
  events_emitted?: number
  error?: string | null
  // Original source before go2rtc normalization, plus the gateway restream URL
  // (present when the feed is routed through the gateway).
  origin?: string | null
  gateway_stream?: string | null
}

// Body for POST /cameras.
export interface CameraPayload {
  name: string
  source: string
  zone: string
  fps: number
  events: string[]
  mock?: boolean
  // Route the feed through the go2rtc gateway (perception backend, best-effort).
  use_gateway?: boolean
}

// A camera found on the network via ONVIF discovery (GET /discover).
export interface DiscoveredCamera {
  name?: string
  ip: string
  xaddr: string
  manufacturer?: string
  model?: string
}

// Response of GET /discover (best-effort; cameras may be empty).
export interface DiscoverResponse {
  cameras: DiscoveredCamera[]
}

// Body for POST /discover/resolve — turns a discovered camera + creds into an
// rtsp URL.
export interface ResolveCameraRequest {
  xaddr: string
  username: string
  password: string
  profile_index?: number
}

// Response of POST /discover/resolve.
export interface ResolveCameraResponse {
  rtsp_url: string
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

export type StepType = 'h_agent' | 'composio' | 'condition' | 'voice' | 'mcp' | 'inventory_adjust'

export interface WorkflowTrigger {
  // 'event' (default): fire on a matching detection. 'schedule': fire on cron.
  type?: 'event' | 'schedule'
  event_type?: EventType
  zone?: string
  min_confidence?: number
  cooldown_sec?: number
  // schedule triggers
  cron?: string
  lookback_hours?: number
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

// One movement the H agent made, as surfaced by the automation service's
// /agent/sessions/{id}/events proxy (see automation/agent_view.py).
export interface AgentStep {
  index: number
  kind: 'action' | 'answer'
  title: string
  detail?: string | null
  // Proxied screenshot path (append to AUTOMATION_URL) the agent saw for this step.
  screenshot?: string | null
  cursor?: [number, number] | null
  viewport?: [number, number] | null
  url?: string | null
}

// The live agent-view feed: the agent's screen + an ordered log of its actions.
export interface AgentFeed {
  session_id: string
  status: string
  latest_screenshot?: string | null
  cursor?: [number, number] | null
  viewport?: [number, number] | null
  url?: string | null
  steps: AgentStep[]
  answer?: string | null
}
