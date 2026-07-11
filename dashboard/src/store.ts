import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityItem,
  AppEvent,
  Automation,
  Camera,
  Integration,
} from './types'
import { EVENT_TYPES, EVENT_META } from './constants'
import {
  integrationCatalog,
  seedAutomations,
  seedCameras,
  seedEvents,
} from './mockData'

const KEY = 'palantirv2.state.v1'
const AUTOMATION_URL = import.meta.env.VITE_AUTOMATION_URL as string | undefined

interface PersistedState {
  cameras: Camera[]
  integrations: Integration[]
  automations: Automation[]
  events: AppEvent[]
  activity: ActivityItem[]
}

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as PersistedState
  } catch {
    /* ignore corrupt state */
  }
  return {
    cameras: seedCameras,
    integrations: integrationCatalog,
    automations: seedAutomations,
    events: seedEvents,
    activity: [],
  }
}

// Small non-crypto id. Suffix keeps ids unique within a render tick.
let seq = 0
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`

export function useStore() {
  const [state, setState] = useState<PersistedState>(load)
  const [live, setLive] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* quota / private mode — non-fatal */
    }
  }, [state])

  const pushEvent = useCallback((event: AppEvent) => {
    setState((s) => {
      const cameras = s.cameras.map((c) =>
        c.zone === event.location && c.status === 'live'
          ? { ...c, eventsToday: c.eventsToday + 1 }
          : c,
      )
      // Fire any enabled automation matching this event.
      const activity: ActivityItem[] = []
      const automations = s.automations.map((a) => {
        const match =
          a.enabled &&
          a.trigger === event.event_type &&
          event.confidence >= a.minConfidence &&
          (!a.zone || a.zone === event.location)
        if (!match) return a
        activity.push({
          id: uid('act'),
          time: event.timestamp,
          automation: a.name,
          event_type: event.event_type,
          status: 'running',
          detail: `${EVENT_META[event.event_type].label} in ${event.location} → ${a.actions.length} action(s)`,
        })
        return { ...a, runs: a.runs + 1 }
      })
      return {
        ...s,
        cameras,
        automations,
        events: [event, ...s.events].slice(0, 200),
        activity: [...activity, ...s.activity].slice(0, 100),
      }
    })
  }, [])

  // Live polling of the automation service; falls back to simulation.
  useEffect(() => {
    if (!live) return
    let stopped = false

    async function poll() {
      if (!AUTOMATION_URL) return simulate()
      try {
        const res = await fetch(`${AUTOMATION_URL}/events?limit=5`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) throw new Error(String(res.status))
        const data: AppEvent[] = await res.json()
        const known = new Set(stateRef.current.events.map((e) => e.event_id))
        data.filter((e) => !known.has(e.event_id)).forEach(pushEvent)
      } catch {
        simulate() // backend unreachable — keep the demo alive
      }
    }

    function simulate() {
      const type = EVENT_TYPES[Math.floor(seededRandom() * EVENT_TYPES.length)]
      const zones = stateRef.current.cameras
        .filter((c) => c.status === 'live' && c.detects.includes(type))
        .map((c) => c.zone)
      if (zones.length === 0) return
      const location = zones[Math.floor(seededRandom() * zones.length)]
      pushEvent({
        event_id: uid('evt'),
        event_type: type,
        timestamp: new Date().toISOString(),
        confidence: Number((0.65 + seededRandom() * 0.34).toFixed(2)),
        location,
        payload:
          type === 'person_count' || type === 'foot_traffic'
            ? { count: Math.floor(5 + seededRandom() * 40) }
            : { detail: 'Detected by Cosmos 3 Reasoner' },
      })
    }

    const t = setInterval(() => {
      if (!stopped) poll()
    }, 4500)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [live, pushEvent])

  // --- mutations ---------------------------------------------------------

  const addCamera = useCallback((c: Omit<Camera, 'id' | 'eventsToday'>) => {
    const camera: Camera = { ...c, id: uid('cam'), eventsToday: 0 }
    setState((s) => ({ ...s, cameras: [...s.cameras, camera] }))
  }, [])

  const removeCamera = useCallback((id: string) => {
    setState((s) => ({ ...s, cameras: s.cameras.filter((c) => c.id !== id) }))
  }, [])

  const toggleCamera = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      cameras: s.cameras.map((c) =>
        c.id === id
          ? { ...c, status: c.status === 'live' ? 'offline' : 'live' }
          : c,
      ),
    }))
  }, [])

  const setIntegrationStatus = useCallback(
    (id: string, status: Integration['status'], accountLabel?: string) => {
      setState((s) => ({
        ...s,
        integrations: s.integrations.map((i) =>
          i.id === id
            ? {
                ...i,
                status,
                accountLabel:
                  status === 'connected' ? accountLabel ?? i.accountLabel : undefined,
              }
            : i,
        ),
      }))
    },
    [],
  )

  const addIntegration = useCallback((i: Omit<Integration, 'id'>) => {
    setState((s) => ({
      ...s,
      integrations: [...s.integrations, { ...i, id: uid('int') }],
    }))
  }, [])

  const addAutomation = useCallback((a: Omit<Automation, 'id' | 'runs'>) => {
    setState((s) => ({
      ...s,
      automations: [...s.automations, { ...a, id: uid('auto'), runs: 0 }],
    }))
  }, [])

  const toggleAutomation = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      automations: s.automations.map((a) =>
        a.id === id ? { ...a, enabled: !a.enabled } : a,
      ),
    }))
  }, [])

  const removeAutomation = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      automations: s.automations.filter((a) => a.id !== id),
    }))
  }, [])

  const resetDemo = useCallback(() => {
    localStorage.removeItem(KEY)
    setState(load())
  }, [])

  return {
    ...state,
    live,
    setLive,
    addCamera,
    removeCamera,
    toggleCamera,
    setIntegrationStatus,
    addIntegration,
    addAutomation,
    toggleAutomation,
    removeAutomation,
    resetDemo,
  }
}

export type Store = ReturnType<typeof useStore>

// Deterministic-ish PRNG so the simulation doesn't rely on Math.random being
// seeded; good enough to vary demo events.
let s0 = 0x9e3779b9
function seededRandom() {
  s0 ^= s0 << 13
  s0 ^= s0 >>> 17
  s0 ^= s0 << 5
  return ((s0 >>> 0) % 100000) / 100000
}
