import { useEffect, useState } from 'react'
import type { Store } from '../store'
import type { AuthType, Integration, IntegrationCategory } from '../types'
import { CATEGORY_LABEL } from '../constants'
import { Modal } from '../components/Modal'
import { IconPlus, IconCheck } from '../components/icons'
import { api, type BackendStatus } from '../api'

// Integrations whose real state lives in automation/.env — when the backend
// is reachable we show its truth and disable the local connect/disconnect.
const ENV_MANAGED: Record<string, (s: BackendStatus) => { connected: boolean; label?: string }> = {
  h_agent: (s) => ({
    connected: s.h_agent.key_present,
    label: s.h_agent.key_present ? `mode: ${s.h_agent.mode}` : undefined,
  }),
  gdrive: (s) => ({ connected: s.composio.configured, label: s.composio.configured ? 'via Composio' : undefined }),
  gsheets: (s) => ({ connected: s.composio.configured, label: s.composio.configured ? 'via Composio' : undefined }),
  slack: (s) => ({ connected: s.composio.configured, label: s.composio.configured ? 'via Composio' : undefined }),
  gradium_voice: (s) => ({ connected: s.gradium.configured }),
}

const ENV_HINT: Record<string, string> = {
  h_agent: 'Set HAI_API_KEY in automation/.env',
  gdrive: 'Set COMPOSIO_API_KEY + link account (NOTES.md)',
  gsheets: 'Set COMPOSIO_API_KEY + link account (NOTES.md)',
  slack: 'Set COMPOSIO_API_KEY + link account (NOTES.md)',
  gradium_voice: 'Set GRADIUM_API_KEY in automation/.env',
}

const LOGO: Record<string, string> = {
  h_agent: '🤖',
  gdrive: '📁',
  gsheets: '📊',
  slack: '💬',
  gradium_voice: '🔊',
  webhook: '🔗',
}

const AUTH_COPY: Record<AuthType, { cta: string; field: string; placeholder: string }> = {
  oauth: { cta: 'Connect account', field: 'Account email', placeholder: 'you@company.com' },
  apikey: { cta: 'Add API key', field: 'API key', placeholder: 'sk-…' },
  webhook: { cta: 'Save endpoint', field: 'Webhook URL', placeholder: 'https://…' },
}

export function Integrations({ store }: { store: Store }) {
  const [connecting, setConnecting] = useState<Integration | null>(null)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<BackendStatus | null>(null)

  useEffect(() => {
    if (!api.configured()) return
    let cancelled = false
    const load = () =>
      api
        .status()
        .then((s) => !cancelled && setStatus(s))
        .catch(() => !cancelled && setStatus(null))
    load()
    const t = setInterval(load, 10_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // With a live backend, env-managed cards show the backend's truth.
  const effective = (i: Integration): Integration => {
    if (!status || !ENV_MANAGED[i.id]) return i
    const real = ENV_MANAGED[i.id](status)
    return {
      ...i,
      status: real.connected ? 'connected' : 'disconnected',
      accountLabel: real.label,
    }
  }
  const integrations = store.integrations.map(effective)

  return (
    <div className="stack gap-16">
      <div className="section-head">
        <h2>Integrations</h2>
        <span className="muted">
          {integrations.filter((i) => i.status === 'connected').length} connected
        </span>
        <div className="spacer" />
        <span className="badge">
          <span className={`dot ${status ? 'live' : 'offline'}`} />
          {status ? 'live status from backend' : 'local demo state'}
        </span>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={16} /> Create integration
        </button>
      </div>

      {status && (
        <div className="card" style={{ padding: '12px 16px' }}>
          <div className="row wrap gap-6">
            <span className="chip" style={{ color: 'var(--accent-2)' }}>
              🤖 agent mode: {status.h_agent.mode}
            </span>
            <span className="chip">
              NemoClaw {status.nemoclaw.active ? `→ ${status.nemoclaw.url}` : 'inactive'}
            </span>
            <span className="chip">{status.counts.workflows} workflows</span>
            <span className="chip">{status.counts.events} events</span>
            <span className="chip">{status.counts.runs} runs</span>
          </div>
        </div>
      )}

      <div className="grid grid-3">
        {integrations.map((i) => {
          const envManaged = Boolean(status && ENV_MANAGED[i.id])
          return (
            <div className="int-card" key={i.id}>
              <div className="int-top">
                <div className="int-logo">{LOGO[i.id] ?? '🔌'}</div>
                <div>
                  <h3>{i.name}</h3>
                  <div className="cat">{CATEGORY_LABEL[i.category]}</div>
                </div>
                <div className="spacer" style={{ flex: 1 }} />
                {i.status === 'connected' && (
                  <span className="badge" style={{ color: 'var(--success)' }}>
                    <IconCheck size={13} /> connected
                  </span>
                )}
              </div>
              <div className="int-desc">{i.description}</div>
              <div className="int-foot">
                {i.accountLabel && <span className="chip">{i.accountLabel}</span>}
                <div className="spacer" style={{ flex: 1 }} />
                {envManaged ? (
                  i.status === 'connected' ? (
                    <span className="chip">env-managed</span>
                  ) : (
                    <span className="chip" title={ENV_HINT[i.id]}>
                      {ENV_HINT[i.id]}
                    </span>
                  )
                ) : i.status === 'connected' ? (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => store.setIntegrationStatus(i.id, 'disconnected')}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setConnecting(i)}
                  >
                    {AUTH_COPY[i.authType].cta}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {connecting && (
        <ConnectModal
          integration={connecting}
          onClose={() => setConnecting(null)}
          onConnect={(label) => {
            store.setIntegrationStatus(connecting.id, 'connected', label)
            setConnecting(null)
          }}
        />
      )}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreate={(i) => {
            store.addIntegration(i)
            setCreating(false)
          }}
        />
      )}
    </div>
  )
}

function ConnectModal({
  integration,
  onClose,
  onConnect,
}: {
  integration: Integration
  onClose: () => void
  onConnect: (label: string) => void
}) {
  const copy = AUTH_COPY[integration.authType]
  const [value, setValue] = useState('')
  const valid = value.trim().length > 0

  const labelFor = () =>
    integration.authType === 'apikey'
      ? `key ••••${value.trim().slice(-4)}`
      : value.trim()

  return (
    <Modal
      title={`Connect ${integration.name}`}
      subtitle={integration.description}
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
            onClick={() => valid && onConnect(labelFor())}
          >
            {copy.cta}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{copy.field}</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={copy.placeholder}
          autoFocus
        />
        <span className="hint">
          {integration.authType === 'oauth'
            ? 'In production this opens the provider OAuth screen via Composio.'
            : 'Stored server-side by the automation service — never in the browser.'}
        </span>
      </div>
    </Modal>
  )
}

function CreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (i: Omit<Integration, 'id'>) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<IntegrationCategory>('custom')
  const [authType, setAuthType] = useState<AuthType>('apikey')
  const [description, setDescription] = useState('')
  const valid = name.trim().length > 0

  return (
    <Modal
      title="Create integration"
      subtitle="Register a new action target for your automations."
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
                category,
                authType,
                status: 'disconnected',
                description:
                  description.trim() || 'Custom integration target.',
              })
            }
          >
            Create
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jira, Notion, PagerDuty"
          autoFocus
        />
      </div>
      <div className="field">
        <label>Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as IntegrationCategory)}
        >
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Authentication</label>
        <select
          value={authType}
          onChange={(e) => setAuthType(e.target.value as AuthType)}
        >
          <option value="apikey">API key</option>
          <option value="oauth">OAuth</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>
      <div className="field">
        <label>Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this integration does"
        />
      </div>
    </Modal>
  )
}
