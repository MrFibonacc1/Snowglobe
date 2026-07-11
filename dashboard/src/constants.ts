import type { EventType, IntegrationCategory, CameraSource } from './types'

export const EVENT_META: Record<
  EventType,
  { label: string; color: string; icon: string }
> = {
  spill: { label: 'Spill', color: '#f87171', icon: '💧' },
  person_count: { label: 'People count', color: '#22d3ee', icon: '👥' },
  foot_traffic: { label: 'Foot traffic', color: '#a78bfa', icon: '🚶' },
  safety_violation: { label: 'Safety violation', color: '#fbbf24', icon: '⚠️' },
}

export const EVENT_TYPES = Object.keys(EVENT_META) as EventType[]

export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  agent: 'Computer-use agent',
  storage: 'Storage',
  messaging: 'Messaging',
  voice: 'Voice',
  custom: 'Custom',
}

export const SOURCE_LABEL: Record<CameraSource, string> = {
  webcam: 'Local webcam',
  rtsp: 'RTSP / IP camera',
  file: 'Video file',
  hls: 'HLS stream',
}
