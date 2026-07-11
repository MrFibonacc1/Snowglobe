import { useState } from 'react'
import type { Store } from '../store'
import type { AuthType, Integration, IntegrationCategory } from '../types'
import { CATEGORY_LABEL } from '../constants'
import { Modal } from '../components/Modal'
import { IconPlus, IconCheck } from '../components/icons'

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

  return (
    <div className="stack gap-16">
      <div className="section-head">
        <h2>Integrations</h2>
        <span className="muted">
          {store.integrations.filter((i) => i.status === 'connected').length} connected
        </span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={16} /> Create integration
        </button>
      </div>

      <div className="grid grid-3">
        {store.integrations.map((i) => (
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
              {i.status === 'connected' ? (
                <>
                  {i.accountLabel && (
                    <span className="chip">{i.accountLabel}</span>
                  )}
                  <div className="spacer" style={{ flex: 1 }} />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => store.setIntegrationStatus(i.id, 'disconnected')}
                  >
                    Disconnect
                  </button>
                </>
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
        ))}
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
