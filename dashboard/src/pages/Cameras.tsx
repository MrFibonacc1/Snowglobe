import { useState } from 'react'
import type { Store } from '../store'
import type { Camera, CameraSource, EventType } from '../types'
import { EVENT_META, EVENT_TYPES, SOURCE_LABEL } from '../constants'
import { Modal } from '../components/Modal'
import { IconPlus, IconTrash, IconCamera } from '../components/icons'

const SOURCES: { id: CameraSource; d: string }[] = [
  { id: 'webcam', d: 'This machine' },
  { id: 'rtsp', d: 'rtsp:// URL' },
  { id: 'hls', d: '.m3u8 stream' },
  { id: 'file', d: 'Uploaded clip' },
]

export function Cameras({ store }: { store: Store }) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="stack gap-16">
      <div className="section-head">
        <h2>Cameras</h2>
        <span className="muted">{store.cameras.length} connected</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <IconPlus size={16} /> Connect camera
        </button>
      </div>

      {store.cameras.length === 0 ? (
        <div className="empty">
          No cameras yet. Connect a webcam, RTSP feed, or clip to start
          producing events.
        </div>
      ) : (
        <div className="grid grid-3">
          {store.cameras.map((cam) => (
            <CameraCard key={cam.id} cam={cam} store={store} />
          ))}
        </div>
      )}

      {adding && (
        <AddCameraModal
          onClose={() => setAdding(false)}
          onAdd={(c) => {
            store.addCamera(c)
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

function CameraCard({ cam, store }: { cam: Camera; store: Store }) {
  const [snapBroken, setSnapBroken] = useState(false)
  // Latest event from this camera's zone that carries a frame — the closest
  // thing to a live preview without streaming video into the browser.
  const snap = store.events.find(
    (e) => e.location === cam.zone && e.snapshot_url,
  )?.snapshot_url

  return (
    <div className="cam-card">
      <div className="cam-preview">
        {snap && !snapBroken && (
          <img
            className="cam-snap"
            src={snap}
            alt=""
            onError={() => setSnapBroken(true)}
          />
        )}
        {cam.status === 'live' && <div className="scan" />}
        <div className="live-tag">
          <span className="badge">
            <span className={`dot ${cam.status}`} />
            {cam.status}
          </span>
        </div>
        {(!snap || snapBroken) && <IconCamera size={30} />}
        <div className="fps-tag">{cam.fps} fps</div>
      </div>
      <div className="cam-body">
        <div className="cam-title">
          <h3>{cam.name}</h3>
        </div>
        <div className="cam-meta">
          <span className="chip">{cam.zone}</span>
          <span className="chip">{SOURCE_LABEL[cam.source]}</span>
          <span className="chip">{cam.eventsToday} events today</span>
        </div>
        <div className="cam-meta">
          {cam.detects.map((d) => (
            <span
              key={d}
              className="chip"
              style={{ color: EVENT_META[d].color }}
            >
              {EVENT_META[d].icon} {EVENT_META[d].label}
            </span>
          ))}
        </div>
        <div className="cam-foot">
          <button
            className="btn btn-sm"
            onClick={() => store.toggleCamera(cam.id)}
          >
            {cam.status === 'live' ? 'Pause' : 'Resume'}
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-danger btn-sm"
            onClick={() => store.removeCamera(cam.id)}
            aria-label="Remove camera"
          >
            <IconTrash size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

function AddCameraModal({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (c: Omit<Camera, 'id' | 'eventsToday'>) => void
}) {
  const [name, setName] = useState('')
  const [zone, setZone] = useState('zone_a')
  const [source, setSource] = useState<CameraSource>('rtsp')
  const [url, setUrl] = useState('')
  const [detects, setDetects] = useState<EventType[]>(['person_count', 'spill'])

  const needsUrl = source === 'rtsp' || source === 'hls'
  const valid = name.trim() && zone.trim() && (!needsUrl || url.trim())

  const toggle = (t: EventType) =>
    setDetects((d) => (d.includes(t) ? d.filter((x) => x !== t) : [...d, t]))

  return (
    <Modal
      title="Connect a camera"
      subtitle="Add a video source. Detections stream into the event feed at the sampled frame rate."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            style={{ opacity: valid ? 1 : 0.5 }}
            onClick={() =>
              valid &&
              onAdd({
                name: name.trim(),
                zone: zone.trim(),
                source,
                url: needsUrl ? url.trim() : undefined,
                status: 'connecting',
                fps: 1,
                detects,
              })
            }
          >
            Connect
          </button>
        </>
      }
    >
      <div className="field">
        <label>Source type</label>
        <div className="source-grid">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              className={`source-opt ${source === s.id ? 'sel' : ''}`}
              onClick={() => setSource(s.id)}
            >
              <span className="t">{SOURCE_LABEL[s.id]}</span>
              <span className="d">{s.d}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Camera name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Loading Bay East"
          autoFocus
        />
      </div>

      {needsUrl && (
        <div className="field">
          <label>Stream URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={source === 'rtsp' ? 'rtsp://10.0.0.20/stream1' : 'https://…/index.m3u8'}
          />
          <span className="hint">
            Perception samples this feed at 1 fps and sends frames to the Cosmos 3 Reasoner.
          </span>
        </div>
      )}

      <div className="field">
        <label>Zone</label>
        <input
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder="zone_a"
        />
        <span className="hint">Used to route events to zone-scoped automations.</span>
      </div>

      <div className="field">
        <label>Detect</label>
        <div className="check-row">
          {EVENT_TYPES.map((t) => (
            <button
              key={t}
              className={`pill-check ${detects.includes(t) ? 'sel' : ''}`}
              onClick={() => toggle(t)}
            >
              {EVENT_META[t].icon} {EVENT_META[t].label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
