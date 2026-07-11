import { useState } from 'react'
import type { Store } from '../store'
import type { StepType, Workflow, WorkflowStep } from '../types'
import { EVENT_META, EVENT_TYPES } from '../constants'
import { Modal } from '../components/Modal'
import { IconPlus, IconTrash, IconArrow } from '../components/icons'

const STEP_TYPES: { id: StepType; label: string; icon: string }[] = [
  { id: 'h_agent', label: 'H Agent', icon: '🤖' },
  { id: 'composio', label: 'Composio', icon: '🔌' },
  { id: 'condition', label: 'Condition', icon: '🔀' },
  { id: 'voice', label: 'Voice', icon: '🔊' },
]

const STEP_META = Object.fromEntries(STEP_TYPES.map((s) => [s.id, s])) as Record<
  StepType,
  { id: StepType; label: string; icon: string }
>

const H_TASKS = ['google_form', 'ticket', 'custom_url']
const COMPOSIO_ACTIONS = ['slack_message', 'drive_upload', 'sheets_append']

const TEMPLATE_VARS =
  '{{event.event_type}} {{event.location}} {{event.confidence}} ' +
  '{{event.timestamp}} {{event.snapshot_url}} {{event.payload.count}} {{event.payload.detail}}'

let stepSeq = 0
const newStepId = () => `s_${Date.now().toString(36)}${(stepSeq++).toString(36)}`

function defaultConfig(type: StepType): Record<string, unknown> {
  switch (type) {
    case 'h_agent':
      return { task: 'google_form', url: '', instructions: '' }
    case 'composio':
      return { action: 'slack_message', channel: '', text: '' }
    case 'condition':
      return { expression: 'payload.count > 20' }
    case 'voice':
      return { text: '' }
  }
}

function blankWorkflow(): Workflow {
  return {
    id: `wf_${Date.now().toString(36)}`,
    name: '',
    enabled: true,
    trigger: { event_type: 'spill', min_confidence: 0.7, cooldown_sec: 300 },
    steps: [{ id: newStepId(), type: 'h_agent', config: defaultConfig('h_agent') }],
  }
}

export function WorkflowBuilder({ store }: { store: Store }) {
  const [editing, setEditing] = useState<{ wf: Workflow; isNew: boolean } | null>(null)
  const [testedId, setTestedId] = useState<string | null>(null)

  const runTest = async (id: string) => {
    const runId = await store.testWorkflow(id)
    if (runId) {
      setTestedId(id)
      setTimeout(() => setTestedId((t) => (t === id ? null : t)), 2500)
    }
  }

  return (
    <div className="stack gap-16">
      {store.backendOnline === false && (
        <div className="banner warn">
          Automation backend unreachable — editing local copies. Start it with{' '}
          <code>uvicorn main:app --port 8000</code> then use Reset demo to sync.
        </div>
      )}

      <div className="section-head">
        <h2>Workflows</h2>
        <span className="muted">detection → ordered action steps</span>
        <div className="spacer" />
        <button
          className="btn btn-primary"
          onClick={() => setEditing({ wf: blankWorkflow(), isNew: true })}
        >
          <IconPlus size={16} /> New workflow
        </button>
      </div>

      {store.workflows.length === 0 ? (
        <div className="empty">
          No workflows yet. Create one to turn detections into agent + Composio
          actions.
        </div>
      ) : (
        <div className="grid grid-3">
          {store.workflows.map((wf) => {
            const m = EVENT_META[wf.trigger.event_type]
            return (
              <div className="card" key={wf.id}>
                <div className="row between">
                  <h3 style={{ fontSize: 14.5 }}>{wf.name || 'Untitled workflow'}</h3>
                  <button
                    className={`switch ${wf.enabled ? 'on' : ''}`}
                    onClick={() => store.toggleWorkflow(wf.id)}
                    aria-label="Toggle workflow"
                  />
                </div>

                <div className="row wrap gap-6" style={{ margin: '14px 0' }}>
                  <span className="chip" style={{ color: m.color }}>
                    {m.icon} {m.label}
                  </span>
                  {wf.trigger.zone && <span className="chip">{wf.trigger.zone}</span>}
                  <span className="chip">≥ {Math.round(wf.trigger.min_confidence * 100)}%</span>
                  <span className="chip">{wf.trigger.cooldown_sec}s cooldown</span>
                </div>

                <div className="row wrap gap-6" style={{ marginBottom: 14 }}>
                  {wf.steps.map((s, i) => (
                    <span key={s.id} className="row gap-6" style={{ gap: 4 }}>
                      {i > 0 && <IconArrow size={12} />}
                      <span className="chip" style={{ color: 'var(--accent-2)' }}>
                        {STEP_META[s.type]?.icon} {stepSummary(s)}
                      </span>
                    </span>
                  ))}
                </div>

                <div className="row between">
                  <div className="row gap-6">
                    <button
                      className="btn btn-sm"
                      onClick={() => setEditing({ wf: clone(wf), isNew: false })}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => runTest(wf.id)}
                      disabled={!store.backendOnline}
                      title={store.backendOnline ? 'Fire a synthetic event' : 'Backend offline'}
                      style={{ opacity: store.backendOnline ? 1 : 0.5 }}
                    >
                      {testedId === wf.id ? 'Triggered ✓' : 'Test'}
                    </button>
                  </div>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => store.removeWorkflow(wf.id)}
                    aria-label="Delete workflow"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <EditorModal
          initial={editing.wf}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(wf) => {
            store.saveWorkflow(wf, editing.isNew)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function stepSummary(s: WorkflowStep): string {
  if (s.type === 'h_agent') return `H: ${(s.config.task as string) ?? 'agent'}`
  if (s.type === 'composio') return String(s.config.action ?? 'composio')
  if (s.type === 'condition') return 'if …'
  return 'voice'
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function EditorModal({
  initial,
  isNew,
  onClose,
  onSave,
}: {
  initial: Workflow
  isNew: boolean
  onClose: () => void
  onSave: (wf: Workflow) => void
}) {
  const [wf, setWf] = useState<Workflow>(initial)
  const valid = wf.name.trim().length > 0 && wf.steps.length > 0

  const setTrigger = (patch: Partial<Workflow['trigger']>) =>
    setWf((w) => ({ ...w, trigger: { ...w.trigger, ...patch } }))

  const setStep = (id: string, patch: Partial<WorkflowStep>) =>
    setWf((w) => ({
      ...w,
      steps: w.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }))

  const setStepConfig = (id: string, key: string, value: unknown) =>
    setWf((w) => ({
      ...w,
      steps: w.steps.map((s) =>
        s.id === id ? { ...s, config: { ...s.config, [key]: value } } : s,
      ),
    }))

  const addStep = () =>
    setWf((w) => ({
      ...w,
      steps: [
        ...w.steps,
        { id: newStepId(), type: 'composio', config: defaultConfig('composio') },
      ],
    }))

  const removeStep = (id: string) =>
    setWf((w) => ({ ...w, steps: w.steps.filter((s) => s.id !== id) }))

  const moveStep = (idx: number, dir: -1 | 1) =>
    setWf((w) => {
      const j = idx + dir
      if (j < 0 || j >= w.steps.length) return w
      const steps = [...w.steps]
      ;[steps[idx], steps[j]] = [steps[j], steps[idx]]
      return { ...w, steps }
    })

  const changeStepType = (id: string, type: StepType) =>
    setStep(id, { type, config: defaultConfig(type) })

  return (
    <Modal
      title={isNew ? 'New workflow' : 'Edit workflow'}
      subtitle="A trigger plus an ordered list of steps the engine runs when a matching event fires."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            style={{ opacity: valid ? 1 : 0.5 }}
            onClick={() => valid && onSave(wf)}
          >
            {isNew ? 'Create workflow' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input
          value={wf.name}
          onChange={(e) => setWf((w) => ({ ...w, name: e.target.value }))}
          placeholder="e.g. Spill → incident report"
          autoFocus
        />
      </div>

      <div className="builder-cols">
        {/* Trigger */}
        <div className="stack gap-16">
          <div className="field">
            <label>Trigger event</label>
            <div className="check-row">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t}
                  className={`pill-check ${wf.trigger.event_type === t ? 'sel' : ''}`}
                  onClick={() => setTrigger({ event_type: t })}
                >
                  {EVENT_META[t].icon} {EVENT_META[t].label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Zone filter (optional)</label>
            <input
              value={wf.trigger.zone ?? ''}
              onChange={(e) =>
                setTrigger({ zone: e.target.value.trim() || undefined })
              }
              placeholder="any zone"
            />
          </div>
          <div className="field">
            <label>Min confidence — {Math.round(wf.trigger.min_confidence * 100)}%</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={wf.trigger.min_confidence}
              onChange={(e) => setTrigger({ min_confidence: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Cooldown (seconds)</label>
            <input
              type="number"
              min={0}
              value={wf.trigger.cooldown_sec}
              onChange={(e) =>
                setTrigger({ cooldown_sec: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <span className="hint">
              At most one run per (workflow, zone) per window.
            </span>
          </div>
        </div>

        {/* Steps */}
        <div className="stack gap-16">
          <div className="row between">
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' }}>
              Steps ({wf.steps.length})
            </label>
            <button className="btn btn-sm" onClick={addStep}>
              <IconPlus size={14} /> Add step
            </button>
          </div>

          {wf.steps.map((step, idx) => (
            <div className="step-card" key={step.id}>
              <div className="step-head">
                <span className="step-num">{idx + 1}</span>
                <div className="step-type-pills">
                  {STEP_TYPES.map((st) => (
                    <button
                      key={st.id}
                      className={`pill-check ${step.type === st.id ? 'sel' : ''}`}
                      onClick={() => changeStepType(step.id, st.id)}
                    >
                      {st.icon} {st.label}
                    </button>
                  ))}
                </div>
                <div className="spacer" style={{ flex: 1 }} />
                <button
                  className="icon-btn"
                  onClick={() => moveStep(idx, -1)}
                  disabled={idx === 0}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  onClick={() => moveStep(idx, 1)}
                  disabled={idx === wf.steps.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  className="icon-btn"
                  onClick={() => removeStep(step.id)}
                  disabled={wf.steps.length === 1}
                  aria-label="Remove step"
                >
                  <IconTrash size={13} />
                </button>
              </div>

              <StepConfig
                step={step}
                onConfig={(k, v) => setStepConfig(step.id, k, v)}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function StepConfig({
  step,
  onConfig,
}: {
  step: WorkflowStep
  onConfig: (key: string, value: unknown) => void
}) {
  const cfg = step.config as Record<string, string>

  if (step.type === 'h_agent') {
    return (
      <div className="stack gap-16">
        <div className="field">
          <label>Task kind</label>
          <select value={cfg.task ?? 'google_form'} onChange={(e) => onConfig('task', e.target.value)}>
            {H_TASKS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Target URL</label>
          <input
            value={cfg.url ?? ''}
            onChange={(e) => onConfig('url', e.target.value)}
            placeholder="https://forms.gle/…"
          />
        </div>
        <div className="field">
          <label>Instructions</label>
          <textarea
            value={cfg.instructions ?? ''}
            onChange={(e) => onConfig('instructions', e.target.value)}
            placeholder="Fill the incident form: location={{event.location}}…"
          />
          <span className="tmpl-hint">Variables: {TEMPLATE_VARS}</span>
        </div>
      </div>
    )
  }

  if (step.type === 'composio') {
    const action = cfg.action ?? 'slack_message'
    return (
      <div className="stack gap-16">
        <div className="field">
          <label>Action</label>
          <select value={action} onChange={(e) => onConfig('action', e.target.value)}>
            {COMPOSIO_ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {action === 'slack_message' && (
          <>
            <div className="field">
              <label>Channel</label>
              <input
                value={cfg.channel ?? ''}
                onChange={(e) => onConfig('channel', e.target.value)}
                placeholder="#facilities-alerts"
              />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea
                value={cfg.text ?? ''}
                onChange={(e) => onConfig('text', e.target.value)}
                placeholder="🚨 {{event.event_type}} in {{event.location}}"
              />
              <span className="tmpl-hint">Variables: {TEMPLATE_VARS}</span>
            </div>
          </>
        )}
        {action === 'drive_upload' && (
          <>
            <div className="field">
              <label>File</label>
              <input
                value={cfg.file ?? ''}
                onChange={(e) => onConfig('file', e.target.value)}
                placeholder="{{event.snapshot_url}}"
              />
            </div>
            <div className="field">
              <label>Folder</label>
              <input
                value={cfg.folder ?? ''}
                onChange={(e) => onConfig('folder', e.target.value)}
                placeholder="incidents/"
              />
            </div>
          </>
        )}
        {action === 'sheets_append' && (
          <>
            <div className="field">
              <label>Spreadsheet ID</label>
              <input
                value={cfg.spreadsheet_id ?? ''}
                onChange={(e) => onConfig('spreadsheet_id', e.target.value)}
                placeholder="1AbC…"
              />
            </div>
            <div className="field">
              <label>Sheet name</label>
              <input
                value={cfg.sheet_name ?? ''}
                onChange={(e) => onConfig('sheet_name', e.target.value)}
                placeholder="Sheet1"
              />
            </div>
          </>
        )}
      </div>
    )
  }

  if (step.type === 'condition') {
    return (
      <div className="field">
        <label>Expression</label>
        <input
          value={cfg.expression ?? ''}
          onChange={(e) => onConfig('expression', e.target.value)}
          placeholder="payload.count > 20"
        />
        <span className="hint">
          Grammar: &lt;event-path&gt; &lt;op&gt; &lt;value&gt;. Ops: &gt; &lt; &gt;= &lt;= == !=
        </span>
      </div>
    )
  }

  // voice
  return (
    <div className="field">
      <label>Text to speak</label>
      <textarea
        value={cfg.text ?? ''}
        onChange={(e) => onConfig('text', e.target.value)}
        placeholder="Spill detected in {{event.location}}"
      />
      <span className="tmpl-hint">Variables: {TEMPLATE_VARS}</span>
    </div>
  )
}
