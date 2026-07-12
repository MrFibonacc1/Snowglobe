import type { ComponentType } from 'react'
import {
  Droplet,
  Users,
  Footprints,
  TriangleAlert,
  DoorOpen,
  HardHat,
  Flame,
  ShoppingCart,
  Package,
  ShieldAlert,
  Car,
  Clock,
  Trash2,
  Activity,
} from 'lucide-react'
import type { EventType, IntegrationCategory, CameraSource } from './types'

type IconType = ComponentType<{ className?: string; size?: number | string }>

export interface EventMeta {
  label: string
  color: string
  icon: IconType
}

// Warm, food-toned palette used to color event types deterministically. Any
// event type the model invents gets a stable color by hashing its slug into
// this palette — no fixed per-type mapping required.
const PALETTE = [
  '#c2410c', // paprika / terracotta
  '#b45309', // amber / mustard
  '#4d7c0f', // olive
  '#0e7490', // teal
  '#6d28d9', // plum
  '#9d174d', // wine
  '#a16207', // ochre
  '#166534', // herb green
  '#7c2d12', // espresso
  '#1d4ed8', // slate blue
]

// Icon is chosen by keyword, not by a fixed type list. The model can name a
// brand-new event type and it still gets a sensible glyph via these hints;
// anything unmatched falls back to a generic activity icon.
const ICON_HINTS: Array<[RegExp, IconType]> = [
  [/spill|liquid|leak|wet|puddle|water/, Droplet],
  [/exit|door|egress|blocked|obstruct/, DoorOpen],
  [/ppe|helmet|hardhat|hard_hat|vest|glove/, HardHat],
  [/fire|smoke|flame|burn/, Flame],
  [/queue|checkout|cart|shopping|register/, ShoppingCart],
  [/traffic|foot|pedestrian|throughput|walk/, Footprints],
  [/crowd|occupancy|capacity|count|people|person/, Users],
  [/vehicle|forklift|car|truck|driving|collision/, Car],
  [/wait|dwell|idle|delay|time/, Clock],
  [/trash|litter|debris|mess|clutter|unattended|abandon/, Trash2],
  [/package|box|inventory|stock|item/, Package],
  [/theft|intrus|weapon|security|tamper|breach/, ShieldAlert],
  [/hazard|unsafe|violation|danger|risk|warning/, TriangleAlert],
]

function hashSlug(slug: string): number {
  let h = 0
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0
  }
  return h
}

function humanize(slug: string): string {
  const s = (slug || 'event').replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function pickIcon(slug: string): IconType {
  for (const [re, icon] of ICON_HINTS) {
    if (re.test(slug)) return icon
  }
  return Activity
}

// Cache resolved metadata so labels/colors/icons stay stable per type and we
// don't recompute on every render.
const _cache = new Map<string, EventMeta>()

/**
 * Resolve display metadata for ANY event type, derived semantically from the
 * type slug itself. Replaces the old fixed `EVENT_META` record so the UI never
 * crashes on — and always renders — event types the model invents at runtime.
 */
export function eventMeta(type: EventType | undefined | null): EventMeta {
  const slug = (type || 'event').toString().toLowerCase()
  const cached = _cache.get(slug)
  if (cached) return cached
  const meta: EventMeta = {
    label: slug === '*' ? 'Any event' : humanize(slug),
    color: slug === '*' ? '#57534e' : PALETTE[hashSlug(slug) % PALETTE.length],
    icon: slug === '*' ? Activity : pickIcon(slug),
  }
  _cache.set(slug, meta)
  return meta
}

// Suggested starter types shown in pickers. These are just conveniences — the
// system is not limited to them; users can type any slug and the model can
// surface others on its own.
export const SUGGESTED_EVENT_TYPES: EventType[] = [
  'spill',
  'person_count',
  'foot_traffic',
  'safety_violation',
  'blocked_exit',
  'missing_ppe',
  'overcrowding',
  'unattended_item',
]

export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  agent: 'Computer-use agent',
  storage: 'Storage',
  messaging: 'Messaging',
  voice: 'Voice',
  custom: 'Custom',
}

export const SOURCE_LABEL: Record<CameraSource, string> = {
  webcam: 'Local webcam',
  window: 'Night Owl Protect CMS',
  screen: 'Screen region',
  rtsp: 'RTSP / IP camera',
  file: 'Video file',
  hls: 'HLS stream',
}
