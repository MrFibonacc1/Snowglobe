import type { Camera, Integration, Automation, AppEvent } from './types'

export const seedCameras: Camera[] = [
  {
    id: 'cam_lobby',
    name: 'Main Lobby',
    zone: 'zone_a',
    source: 'rtsp',
    url: 'rtsp://10.0.0.11/stream1',
    status: 'live',
    fps: 1,
    detects: ['person_count', 'foot_traffic', 'spill'],
    eventsToday: 42,
  },
  {
    id: 'cam_warehouse',
    name: 'Warehouse Floor',
    zone: 'zone_b',
    source: 'rtsp',
    url: 'rtsp://10.0.0.12/stream1',
    status: 'live',
    fps: 1,
    detects: ['safety_violation', 'spill', 'person_count'],
    eventsToday: 18,
  },
  {
    id: 'cam_entrance',
    name: 'Front Entrance',
    zone: 'zone_c',
    source: 'webcam',
    status: 'connecting',
    fps: 1,
    detects: ['foot_traffic', 'person_count'],
    eventsToday: 7,
  },
]

export const integrationCatalog: Integration[] = [
  {
    id: 'h_agent',
    name: 'H Company Agent',
    category: 'agent',
    status: 'connected',
    description:
      'Runner H / Surfer H computer-use agent. Navigates UIs and fills forms.',
    authType: 'apikey',
    accountLabel: 'team@palantirv2.dev',
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    category: 'storage',
    status: 'connected',
    description: 'File snapshots and reports to Drive (via Composio).',
    authType: 'oauth',
    accountLabel: 'ops@palantirv2.dev',
  },
  {
    id: 'gsheets',
    name: 'Google Sheets',
    category: 'storage',
    status: 'disconnected',
    description: 'Append event rows to a tracking sheet (via Composio).',
    authType: 'oauth',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'messaging',
    status: 'connected',
    description: 'Alert channels when high-priority events fire (via Composio).',
    authType: 'oauth',
    accountLabel: '#facilities-alerts',
  },
  {
    id: 'gradium_voice',
    name: 'Gradium Voice',
    category: 'voice',
    status: 'disconnected',
    description: 'Spoken alerts, e.g. "Spill detected in zone A".',
    authType: 'apikey',
  },
  {
    id: 'webhook',
    name: 'Custom Webhook',
    category: 'custom',
    status: 'disconnected',
    description: 'POST events to any HTTP endpoint you control.',
    authType: 'webhook',
  },
]

export const seedAutomations: Automation[] = [
  {
    id: 'auto_spill',
    name: 'Spill → incident report',
    enabled: true,
    trigger: 'spill',
    minConfidence: 0.7,
    actions: ['h_agent', 'gdrive', 'slack'],
    runs: 12,
  },
  {
    id: 'auto_occupancy',
    name: 'Over capacity → occupancy alert',
    enabled: true,
    trigger: 'person_count',
    zone: 'zone_a',
    minConfidence: 0.6,
    actions: ['gsheets', 'slack'],
    runs: 5,
  },
  {
    id: 'auto_safety',
    name: 'Safety violation → raise ticket',
    enabled: false,
    trigger: 'safety_violation',
    minConfidence: 0.8,
    actions: ['h_agent'],
    runs: 0,
  },
]

const now = Date.now()
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString()

export const seedEvents: AppEvent[] = [
  {
    event_id: 'evt_1',
    event_type: 'spill',
    timestamp: ago(3),
    confidence: 0.91,
    location: 'zone_b',
    payload: { detail: 'Liquid pooled near loading bay' },
  },
  {
    event_id: 'evt_2',
    event_type: 'person_count',
    timestamp: ago(8),
    confidence: 0.86,
    location: 'zone_a',
    payload: { count: 23 },
  },
  {
    event_id: 'evt_3',
    event_type: 'safety_violation',
    timestamp: ago(15),
    confidence: 0.82,
    location: 'zone_b',
    payload: { detail: 'Worker without hard hat' },
  },
  {
    event_id: 'evt_4',
    event_type: 'foot_traffic',
    timestamp: ago(22),
    confidence: 0.78,
    location: 'zone_c',
    payload: { count: 140, window: '1h' },
  },
]
