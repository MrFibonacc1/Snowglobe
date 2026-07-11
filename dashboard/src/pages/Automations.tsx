import { useState } from 'react'
import type { Store } from '../store'
import type { Automation, EventType } from '../types'
import { EVENT_META, EVENT_TYPES } from '../constants'
import { Modal } from '../components/Modal'
import { IconPlus, IconArrow, IconTrash } from '../components/icons'

export function Automations({ store }: { store: Store }) {
  const [creating, setCreating] = useState(false)
  const intName = (id: string) =>
    store.integrations.find((i) => i.id === id)?.name ?? id

  return (
    <div className="stack gap-16">
      <div className="section-head">
        <h2>Automations</h2>
        <span className="muted">event → action rules</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={16} /> New automation
        </button>
      </div>

      {store.automations.length === 0 ? (
        <div className="empty">
          No automations yet. Create a rule to turn detections into actions.
        </div>
      ) : (
        <div className="grid grid-3">
          {store.automations.map((a) => {
            const m = EVENT_META[a.trigger]
            return (
              <div className="card" key={a.id}>
                <div className="row between">
                  <h3 style={{ fontSize: 14.5 }}>{a.name}</h3>
                  <button
                    className={`switch ${a.enabled ? 'on' : ''}`}
                    onClick={() => store.toggleAutomation(a.id)}
                    aria-label="Toggle automation"
                  />
                </div>

                <div className="row wrap gap-6" style={{ margin: '14px 0' }}>
                  <span className="chip" style={{ color: m.color }}>
                    {m.icon} {m.label}
                  </span>
                  {a.zone && <span className="chip">{a.zone}</span>}
                  <span className="chip">≥ {Math.round(a.minConfidence * 100)}%</span>
                  <span className="faint" style={{ display: 'grid', placeItems: 'center' }}>
                    <IconArrow size={15} />
                  </span>
                  {a.actions.map((id) => (
                    <span key={id} className="chip" style={{ color: 'var(--accent-2)' }}>
                      {intName(id)}
                    </span>
                  ))}
                </div>

                <div className="row between">
                  <span className="faint" style={{ fontSize: 12 }}>
                    {a.runs} run{a.runs === 1 ? '' : 's'}
                  </span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => store.removeAutomation(a.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <CreateModal
          store={store}
          onClose={() => setCreating(false)}
          onCreate={(a) => {
            store.addAutomation(a)
            setCreating(false)
          }}
        />
      )}
    </div>
  )
}

function CreateModal({
  store,
  onClose,
  onCreate,
}: {
  store: Store
  onClose: () => void
  onCreate: (a: Omit<Automation, 'id' | 'runs'>) => void
}) {
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<EventType>('spill')
  const [zone, setZone] = useState('')
  const [minConfidence, setMinConfidence] = useState(0.7)
  const [actions, setActions] = useState<string[]>([])
  const valid = name.trim() && actions.length > 0

  const toggle = (id: string) =>
    setActions((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  return (
    <Modal
      title="New automation"
      subtitle="When a detection matches the trigger, run the selected integration actions."
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
              onCreate({
                name: name.trim(),
                enabled: true,
                trigger,
                zone: zone.trim() || undefined,
                minConfidence,
                actions,
              })
            }
          >
            Create automation
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Spill → incident report"
          autoFocus
        />
      </div>

      <div className="field">
        <label>When this is detected</label>
        <div className="check-row">
          {EVENT_TYPES.map((t) => (
            <button
              key={t}
              className={`pill-check ${trigger === t ? 'sel' : ''}`}
              onClick={() => setTrigger(t)}
            >
              {EVENT_META[t].icon} {EVENT_META[t].label}
            </button>
          ))}
        </div>
      </div>

      <div className="source-grid">
        <div className="field">
          <label>Zone filter (optional)</label>
          <input
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder="any zone"
          />
        </div>
        <div className="field">
          <label>Min confidence — {Math.round(minConfidence * 100)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="field">
        <label>Run these actions</label>
        <div className="check-row">
          {store.integrations.map((i) => (
            <button
              key={i.id}
              className={`pill-check ${actions.includes(i.id) ? 'sel' : ''}`}
              onClick={() => toggle(i.id)}
              title={i.status === 'connected' ? '' : 'Not yet connected'}
            >
              {i.name}
              {i.status !== 'connected' && ' ·  ⚠'}
            </button>
          ))}
        </div>
        <span className="hint">
          Actions on disconnected integrations are skipped until you connect them.
        </span>
      </div>
    </Modal>
  )
}
