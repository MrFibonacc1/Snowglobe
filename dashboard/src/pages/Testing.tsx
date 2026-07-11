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
interface DetectResponse {
  model: string
  mock: boolean
  verdicts: Verdict[]
  events: Record<string, unknown>[]
}

export function Testing() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [selected, setSelected] = useState<EventType[]>([...EVENT_TYPES])
  const [zone, setZone] = useState('zone_a')
  const [minConf, setMinConf] = useState(0.5)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DetectResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Object-URL preview, revoked when the file changes/unmounts.
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
    if (!f.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    setError(null)
    setResult(null)
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
      const res = await fetch(`${PERCEPTION_URL}/detect`, { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`detect API returned ${res.status}: ${body.slice(0, 200)}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(
        `Could not reach the perception detect API at ${PERCEPTION_URL}. ` +
          `Start it with:  uvicorn perception.server:app --port 8008` +
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
            onClick={() => inputRef.current?.click()}
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
            {preview ? (
              <img src={preview} alt="upload preview" className="dropzone-img" />
            ) : (
              <div className="dropzone-empty">
                <IconUpload size={26} />
                <div>
                  <b>Click to upload</b> or drag an image here
                </div>
                <span className="faint">PNG / JPG — a frame from a camera or a scene photo</span>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          {file && <div className="faint" style={{ fontSize: 12 }}>{file.name}</div>}

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
            {result && (
              <span className="badge">
                {result.mock ? 'mock' : result.model}
              </span>
            )}
          </div>

          {error && <div className="test-error">{error}</div>}

          {!error && !result && !busy && (
            <div className="empty" style={{ border: 'none' }}>
              Upload an image and run detection to see per-event verdicts and the
              events that would fire.
            </div>
          )}

          {busy && (
            <div className="row gap-6" style={{ padding: '20px 0' }}>
              <div className="spinner" /> <span className="muted">calling the vision model…</span>
            </div>
          )}

          {result && (
            <div className="stack gap-16">
              <div className="feed">
                {result.verdicts.map((v) => {
                  const m = EVENT_META[v.event_type]
                  const fired =
                    v.detected && (v.confidence ?? 0) >= minConf && !v.error
                  return (
                    <div className="feed-row" key={v.event_type}>
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
                          <div className="feed-sub" style={{ color: 'var(--danger)' }}>{v.error}</div>
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
                              {typeof v.elapsed_ms === 'number' && ` · ${v.elapsed_ms}ms`}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div>
                <div className="section-head">
                  <h2 style={{ fontSize: 14 }}>
                    Events emitted ({result.events.length})
                  </h2>
                </div>
                {result.events.length === 0 ? (
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    Nothing crossed the confidence threshold — no events would fire.
                  </div>
                ) : (
                  <pre className="json-block">{JSON.stringify(result.events, null, 2)}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
