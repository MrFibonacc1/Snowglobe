import { useEffect, useRef, useState } from 'react'
import type { EventType } from '../types'
import { EVENT_META, EVENT_TYPES } from '../constants'
import { IconUpload, IconCheck } from '../components/icons'

const PERCEPTION_URL =
  (import.meta.env.VITE_PERCEPTION_URL as string | undefined) ?? 'http://localhost:8008'

interface Verdict {
  event_type: EventType
  detected?: boolean
  confidence?: number
  count?: number | null
  detail?: string | null
  elapsed_ms?: number
  error?: string
}
interface FrameResult {
  index: number
  t_sec: number
  thumb: string
  verdicts: Verdict[]
}
interface SummaryRow {
  event_type: EventType
  fired: boolean
  frames_detected: number
  frames_total: number
  peak_confidence: number
  count: number | null
}
interface DetectResult {
  kind?: 'image' | 'video'
  model: string
  mock: boolean
  verdicts?: Verdict[] // image
  frames?: FrameResult[] // video
  summary?: SummaryRow[] // video
  frames_analyzed?: number
  events: Record<string, unknown>[]
}

export function Testing() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [selected, setSelected] = useState<EventType[]>([...EVENT_TYPES])
  const [zone, setZone] = useState('zone_a')
  const [minConf, setMinConf] = useState(0.5)
  const [maxFrames, setMaxFrames] = useState(6)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DetectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (f: File | null | undefined) => {
    if (!f) return
    const image = f.type.startsWith('image/')
    const video = f.type.startsWith('video/')
    if (!image && !video) {
      setError('Please choose an image or video file.')
      return
    }
    setError(null)
    setResult(null)
    setIsVideo(video)
    setFile(f)
  }

  const toggleEvent = (t: EventType) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))

  async function run() {
    if (!file || selected.length === 0) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('events', selected.join(','))
      fd.append('zone', zone)
      fd.append('min_confidence', String(minConf))
      const endpoint = isVideo ? '/detect_video' : '/detect'
      if (isVideo) fd.append('max_frames', String(maxFrames))
      const res = await fetch(`${PERCEPTION_URL}${endpoint}`, { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`detect API returned ${res.status}: ${body.slice(0, 200)}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(
        `Could not reach the perception detect API at ${PERCEPTION_URL}. ` +
          `Start it (from the repo root) with:  python -m perception.server` +
          `\n(${e instanceof Error ? e.message : String(e)})`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack gap-16">
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Left: upload + controls */}
        <div className="card stack gap-16">
          <div
            className={`dropzone ${dragging ? 'drag' : ''}`}
            onClick={() => !preview && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files?.[0])
            }}
          >
            {preview && isVideo ? (
              <video src={preview} controls className="dropzone-img" />
            ) : preview ? (
              <img src={preview} alt="upload preview" className="dropzone-img" />
            ) : (
              <div className="dropzone-empty">
                <IconUpload size={26} />
                <div>
                  <b>Click to upload</b> or drag an image or video here
                </div>
                <span className="faint">PNG / JPG / MP4 — a photo, a frame, or a short clip</span>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          {file && (
            <div className="row between">
              <span className="faint" style={{ fontSize: 12 }}>
                {isVideo ? '🎬 ' : '🖼 '}
                {file.name}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => inputRef.current?.click()}
              >
                Replace
              </button>
            </div>
          )}

          <div className="field">
            <label>Detect</label>
            <div className="check-row">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t}
                  className={`pill-check ${selected.includes(t) ? 'sel' : ''}`}
                  onClick={() => toggleEvent(t)}
                >
                  {EVENT_META[t].icon} {EVENT_META[t].label}
                </button>
              ))}
            </div>
          </div>

          <div className="source-grid">
            <div className="field">
              <label>Zone</label>
              <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone_a" />
            </div>
            <div className="field">
              <label>Min confidence — {Math.round(minConf * 100)}%</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={minConf}
                onChange={(e) => setMinConf(Number(e.target.value))}
              />
            </div>
          </div>

          {isVideo && (
            <div className="field">
              <label>Frames to sample — {maxFrames}</label>
              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={maxFrames}
                onChange={(e) => setMaxFrames(Number(e.target.value))}
              />
              <span className="hint">
                Each frame runs every selected event type through the model —
                more frames = slower. {maxFrames} frames × {selected.length} type
                {selected.length === 1 ? '' : 's'}.
              </span>
            </div>
          )}

          <button
            className="btn btn-primary"
            disabled={!file || selected.length === 0 || busy}
            style={{ opacity: !file || selected.length === 0 || busy ? 0.5 : 1 }}
            onClick={run}
          >
            {busy ? 'Running detection…' : 'Run detection'}
          </button>
        </div>

        {/* Right: results */}
        <div className="card">
          <div className="section-head">
            <h2>Results</h2>
            <div className="spacer" />
            {result && <span className="badge">{result.mock ? 'mock' : result.model}</span>}
          </div>

          {error && <div className="test-error">{error}</div>}

          {!error && !result && !busy && (
            <div className="empty" style={{ border: 'none' }}>
              Upload an image or video and run detection to see per-event verdicts
              and the events that would fire.
            </div>
          )}

          {busy && (
            <div className="row gap-6" style={{ padding: '20px 0' }}>
              <div className="spinner" />{' '}
              <span className="muted">
                {isVideo ? 'sampling frames and calling the model…' : 'calling the vision model…'}
              </span>
            </div>
          )}

          {result &&
            (result.kind === 'video' ? (
              <VideoResults r={result} minConf={minConf} />
            ) : (
              <ImageResults r={result} minConf={minConf} />
            ))}
        </div>
      </div>
    </div>
  )
}

function EventsBlock({ events }: { events: Record<string, unknown>[] }) {
  return (
    <div>
      <div className="section-head">
        <h2 style={{ fontSize: 14 }}>Events emitted ({events.length})</h2>
      </div>
      {events.length === 0 ? (
        <div className="faint" style={{ fontSize: 12.5 }}>
          Nothing crossed the confidence threshold — no events would fire.
        </div>
      ) : (
        <pre className="json-block">{JSON.stringify(events, null, 2)}</pre>
      )}
    </div>
  )
}

function ImageResults({ r, minConf }: { r: DetectResult; minConf: number }) {
  return (
    <div className="stack gap-16">
      <div className="feed">
        {(r.verdicts ?? []).map((v) => (
          <VerdictRow key={v.event_type} v={v} minConf={minConf} showLatency />
        ))}
      </div>
      <EventsBlock events={r.events} />
    </div>
  )
}

function VideoResults({ r, minConf }: { r: DetectResult; minConf: number }) {
  return (
    <div className="stack gap-16">
      <div className="feed">
        {(r.summary ?? []).map((s) => {
          const m = EVENT_META[s.event_type]
          return (
            <div className="feed-row" key={s.event_type}>
              <div className="feed-ico">{m?.icon ?? '•'}</div>
              <div className="feed-main">
                <div className="feed-title">
                  {m?.label ?? s.event_type}{' '}
                  {s.fired ? (
                    <span style={{ color: 'var(--success)' }}>
                      <IconCheck size={13} /> fires event
                    </span>
                  ) : (
                    <span className="faint">not detected</span>
                  )}
                </div>
                <div className="conf-bar">
                  <div
                    className="conf-fill"
                    style={{
                      width: `${Math.round(s.peak_confidence * 100)}%`,
                      background: m?.color ?? 'var(--accent)',
                    }}
                  />
                </div>
                <div className="feed-sub">
                  peak {Math.round(s.peak_confidence * 100)}% · detected in{' '}
                  {s.frames_detected}/{s.frames_total} frames
                  {typeof s.count === 'number' && ` · count ${s.count}`}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <div className="section-head">
          <h2 style={{ fontSize: 14 }}>Timeline ({r.frames_analyzed} frames)</h2>
        </div>
        <div className="frame-strip">
          {(r.frames ?? []).map((f) => {
            const fired = f.verdicts.filter(
              (v) => v.detected && (v.confidence ?? 0) >= minConf,
            )
            return (
              <div className="frame-thumb" key={f.index}>
                <img src={f.thumb} alt={`frame ${f.index}`} />
                <div className="frame-cap">{f.t_sec}s</div>
                <div className="frame-badges">
                  {fired.length === 0 ? (
                    <span className="faint" style={{ fontSize: 11 }}>—</span>
                  ) : (
                    fired.map((v) => (
                      <span key={v.event_type} title={EVENT_META[v.event_type]?.label}>
                        {EVENT_META[v.event_type]?.icon}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <EventsBlock events={r.events} />
    </div>
  )
}

function VerdictRow({
  v,
  minConf,
  showLatency,
}: {
  v: Verdict
  minConf: number
  showLatency?: boolean
}) {
  const m = EVENT_META[v.event_type]
  const fired = v.detected && (v.confidence ?? 0) >= minConf && !v.error
  return (
    <div className="feed-row">
      <div className="feed-ico">{m?.icon ?? '•'}</div>
      <div className="feed-main">
        <div className="feed-title">
          {m?.label ?? v.event_type}{' '}
          {v.error ? (
            <span style={{ color: 'var(--danger)' }}>error</span>
          ) : fired ? (
            <span style={{ color: 'var(--success)' }}>
              <IconCheck size={13} /> fires event
            </span>
          ) : v.detected ? (
            <span className="faint">below threshold</span>
          ) : (
            <span className="faint">not detected</span>
          )}
        </div>
        {v.error ? (
          <div className="feed-sub" style={{ color: 'var(--danger)' }}>
            {v.error}
          </div>
        ) : (
          <>
            <div className="conf-bar">
              <div
                className="conf-fill"
                style={{
                  width: `${Math.round((v.confidence ?? 0) * 100)}%`,
                  background: m?.color ?? 'var(--accent)',
                }}
              />
            </div>
            <div className="feed-sub">
              {Math.round((v.confidence ?? 0) * 100)}% confidence
              {typeof v.count === 'number' && ` · count ${v.count}`}
              {v.detail && ` · ${v.detail}`}
              {showLatency && typeof v.elapsed_ms === 'number' && ` · ${v.elapsed_ms}ms`}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
