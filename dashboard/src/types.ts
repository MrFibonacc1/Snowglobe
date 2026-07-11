// Mirrors shared/event_schema.json plus dashboard-only config entities.

export type EventType =
  | 'spill'
  | 'person_count'
  | 'foot_traffic'
  | 'safety_violation'

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
