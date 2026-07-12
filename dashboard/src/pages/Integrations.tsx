import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Store } from '../store'
import type { AuthType, Integration, IntegrationCategory } from '../types'
import { CATEGORY_LABEL } from '../constants'
import { api, type BackendStatus, type ComposioTool } from '../api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from './Cameras'
import { StatusDot } from '@/components/ui-kit'
import type { ComponentType } from 'react'
import {
  Plus,
  Check,
  Bot,
  Folder,
  Sheet,
  MessageSquare,
  Volume2,
  Link2,
  Plug,
  Loader2,
} from 'lucide-react'

// Dashboard integration id → Composio toolkit slug. Only these three link via
// Composio OAuth from the UI; other env-managed cards are .env keys.
const COMPOSIO_TOOLKIT: Record<string, 'slack' | 'googlesheets' | 'googledrive'> = {
  slack: 'slack',
  gsheets: 'googlesheets',
  gdrive: 'googledrive',
}

// Integrations whose real state lives in automation/.env — when the backend
// is reachable we show its truth and disable the local connect/disconnect.
const ENV_MANAGED: Record<string, (s: BackendStatus) => { connected: boolean; label?: string }> = {
  h_agent: (s) => ({
    connected: s.h_agent.key_present,
    label: s.h_agent.key_present ? `mode: ${s.h_agent.mode}` : undefined,
  }),
  gdrive: (s) => ({
    connected: s.composio.execution_ready && s.composio.toolkits.googledrive,
    label: s.composio.execution_ready && s.composio.toolkits.googledrive ? 'execution ready' : undefined,
  }),
  gsheets: (s) => ({
    connected: s.composio.execution_ready && s.composio.toolkits.googlesheets,
    label: s.composio.execution_ready && s.composio.toolkits.googlesheets ? 'execution ready' : undefined,
  }),
  slack: (s) => ({
    connected: s.composio.execution_ready && s.composio.toolkits.slack,
    label: s.composio.execution_ready && s.composio.toolkits.slack ? 'execution ready' : undefined,
  }),
  gradium_voice: (s) => ({ connected: s.gradium.configured }),
}

const ENV_HINT: Record<string, string> = {
  h_agent: 'Set HAI_API_KEY in automation/.env',
  gdrive: 'Requires an execution-enabled Composio key and linked Google Drive account',
  gsheets: 'Requires an execution-enabled Composio key and linked Google Sheets account',
  slack: 'Requires an execution-enabled Composio key and linked Slack account',
  gradium_voice: 'Set GRADIUM_API_KEY in automation/.env',
}

type LogoIcon = ComponentType<{ className?: string; size?: number | string }>

const LOGO: Record<string, LogoIcon> = {
  h_agent: Bot,
  gdrive: Folder,
  gsheets: Sheet,
  slack: MessageSquare,
  gradium_voice: Volume2,
  webhook: Link2,
}

const AUTH_COPY: Record<AuthType, { cta: string; field: string; placeholder: string }> = {
  oauth: { cta: 'Connect account', field: 'Account email', placeholder: 'you@company.com' },
  apikey: { cta: 'Add API key', field: 'API key', placeholder: 'sk-…' },
  webhook: { cta: 'Save endpoint', field: 'Webhook URL', placeholder: 'https://…' },
}

export function Integrations({ store }: { store: Store }) {
  const [connecting, setConnecting] = useState<Integration | null>(null)
  const [creating, setCreating] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [status, setStatus] = useState<BackendStatus | null>(null)
  // Card id currently mid-OAuth (we poll faster until it links).
  const [linking, setLinking] = useState<string | null>(null)

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

  // While a Composio link is pending, poll /status (cache-busting) every few
  // seconds so the card flips to "connected" right after the user authorizes.
  useEffect(() => {
    if (!linking) return
    const toolkit = COMPOSIO_TOOLKIT[linking]
    let tries = 0
    const t = setInterval(async () => {
      tries += 1
      try {
        const s = await api.status(true)
        setStatus(s)
        if (toolkit && s.composio.toolkits[toolkit]) {
          toast.success('Connected', { description: `${linking} is now linked.` })
          setLinking(null)
        }
      } catch {
        /* keep waiting */
      }
      if (tries >= 45) setLinking(null) // ~3 min cap
    }, 4000)
    return () => clearInterval(t)
  }, [linking])

  const connectComposio = async (cardId: string) => {
    const toolkit = COMPOSIO_TOOLKIT[cardId]
    if (!toolkit) return
    setLinking(cardId)
    try {
      const { redirect_url } = await api.connectComposio(toolkit)
      window.open(redirect_url, '_blank', 'noopener,noreferrer')
      toast.info('Finish sign-in in the new tab', {
        description: 'This card updates automatically once you authorize.',
      })
    } catch (e) {
      toast.error('Could not start the link', {
        description: e instanceof Error ? e.message : String(e),
      })
      setLinking(null)
    }
  }

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">Integrations</h2>
          <span className="text-sm text-muted-foreground">
            {integrations.filter((i) => i.status === 'connected').length} connected
          </span>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <StatusDot status={status ? 'live' : 'offline'} />
          {status ? 'live status from backend' : 'local demo state'}
        </Badge>
        <Button variant="outline" onClick={() => setCreating(true)} className="gap-1.5">
          Custom…
        </Button>
        <Button onClick={() => setBrowsing(true)} className="gap-1.5">
          <Plus className="size-4" /> Add integration
        </Button>
      </div>

      {status && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <Badge variant="secondary" className="gap-1">
              <Bot className="size-3" /> agent mode: {status.h_agent.mode}
            </Badge>
            <Badge variant="outline">
              NemoClaw {status.nemoclaw.active ? `-> ${status.nemoclaw.url}` : 'inactive'}
            </Badge>
            <Badge variant={status.composio.configured ? 'secondary' : 'destructive'}>
              Composio {status.composio.configured ? 'execution ready' : status.composio.reason ?? 'not ready'}
            </Badge>
            <Badge variant="outline">{status.counts.workflows} workflows</Badge>
            <Badge variant="outline">{status.counts.events} events</Badge>
            <Badge variant="outline">{status.counts.runs} runs</Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {integrations.map((i) => {
          const Logo = LOGO[i.id] ?? Plug
          const envManaged = Boolean(status && ENV_MANAGED[i.id])
          return (
          <Card key={i.id}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Logo className="size-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{i.name}</h3>
                  <div className="text-xs text-muted-foreground">
                    {CATEGORY_LABEL[i.category]}
                  </div>
                </div>
                {i.status === 'connected' && (
                  <Badge variant="outline" className="ml-auto gap-1 border-emerald-500/40 text-emerald-500">
                    <Check className="size-3" /> connected
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{i.description}</p>
              <div className="mt-1 flex items-center gap-2">
                {i.accountLabel && <Badge variant="outline">{i.accountLabel}</Badge>}
                {envManaged ? (
                  i.status === 'connected' ? (
                    <Badge variant="secondary" className="ml-auto">env-managed</Badge>
                  ) : COMPOSIO_TOOLKIT[i.id] && status?.composio.execution_ready ? (
                    // Execution-ready Composio key → link this toolkit via OAuth
                    // right from the UI (no CLI).
                    <Button
                      size="sm"
                      className="ml-auto gap-1.5"
                      disabled={linking === i.id}
                      onClick={() => connectComposio(i.id)}
                    >
                      {linking === i.id && <Loader2 className="size-4 animate-spin" />}
                      {linking === i.id ? 'Waiting…' : 'Connect'}
                    </Button>
                  ) : (
                    <span
                      className="ml-auto text-xs text-muted-foreground"
                      title={ENV_HINT[i.id]}
                    >
                      {ENV_HINT[i.id]}
                    </span>
                  )
                ) : i.status === 'connected' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => store.setIntegrationStatus(i.id, 'disconnected')}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" className="ml-auto" onClick={() => setConnecting(i)}>
                    {AUTH_COPY[i.authType].cta}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          )
        })}
      </div>

      {connecting && (
        <ConnectDialog
          integration={connecting}
          onClose={() => setConnecting(null)}
          onConnect={(label) => {
            store.setIntegrationStatus(connecting.id, 'connected', label)
            setConnecting(null)
          }}
        />
      )}

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreate={(i) => {
            store.addIntegration(i)
            setCreating(false)
          }}
        />
      )}

      {browsing && (
        <CatalogDialog
          executionReady={Boolean(status?.composio.execution_ready)}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  )
}

function CatalogDialog({
  executionReady,
  onClose,
}: {
  executionReady: boolean
  onClose: () => void
}) {
  const [tools, setTools] = useState<ComposioTool[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [connecting, setConnecting] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .composioCatalog()
      .then((r) => !cancelled && setTools(r.toolkits))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const term = q.trim().toLowerCase()
  const all = tools ?? []
  const matches = term
    ? all.filter(
        (t) =>
          t.name.toLowerCase().includes(term) ||
          t.slug.includes(term) ||
          t.categories.some((c) => c.toLowerCase().includes(term)),
      )
    : all
  const shown = matches.slice(0, 120)

  const connect = async (slug: string) => {
    setConnecting(slug)
    try {
      const { redirect_url } = await api.connectComposio(slug)
      window.open(redirect_url, '_blank', 'noopener,noreferrer')
      toast.info('Finish sign-in in the new tab', {
        description: `Authorize ${slug} to link it, then use it in a Composio step.`,
      })
    } catch (e) {
      toast.error('Could not start the link', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setConnecting(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a Composio integration</DialogTitle>
          <DialogDescription>
            Browse {tools ? tools.length.toLocaleString() : '…'} tools Composio can drive. Connect one,
            then reference it in a workflow’s <span className="font-mono">composio</span> step.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — Slack, Notion, Jira, GitHub, HubSpot…"
          autoFocus
        />

        {!executionReady && (
          <p className="text-xs text-amber-600">
            Composio key isn’t execution-ready yet — connecting may fail until it is.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-6 text-center text-sm text-amber-800">
              Couldn’t load the catalog: {error}
            </div>
          ) : !tools ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading Composio catalog…
            </div>
          ) : shown.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No tools match “{q}”.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((t) => (
                <div key={t.slug} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {t.logo ? (
                      <img
                        src={t.logo}
                        alt=""
                        className="size-9 object-contain"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    ) : (
                      <Plug className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t.tools_count} tools</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.description || t.categories.join(', ') || t.slug}
                    </div>
                  </div>
                  {t.no_auth ? (
                    <Badge variant="secondary" className="shrink-0">
                      no auth
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      disabled={connecting === t.slug}
                      onClick={() => connect(t.slug)}
                    >
                      {connecting === t.slug && <Loader2 className="size-3.5 animate-spin" />}
                      Connect
                    </Button>
                  )}
                </div>
              ))}
              {matches.length > shown.length && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Showing {shown.length} of {matches.length.toLocaleString()} — refine your search to see more.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConnectDialog({
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {integration.name}</DialogTitle>
          <DialogDescription>{integration.description}</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field
            label={copy.field}
            hint={
              integration.authType === 'oauth'
                ? 'In production this opens the provider OAuth screen via Composio.'
                : 'Stored server-side by the automation service, never in the browser.'
            }
          >
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={copy.placeholder}
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => valid && onConnect(labelFor())}>
            {copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateDialog({
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create integration</DialogTitle>
          <DialogDescription>
            Register a new action target for your automations.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jira, Notion, PagerDuty"
              autoFocus
            />
          </Field>
          <Field label="Category">
            <Select value={category} onValueChange={(v) => setCategory(v as IntegrationCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Authentication">
            <Select value={authType} onValueChange={(v) => setAuthType(v as AuthType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apikey">API key</SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this integration does"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              valid &&
              onCreate({
                name: name.trim(),
                category,
                authType,
                status: 'disconnected',
                description: description.trim() || 'Custom integration target.',
              })
            }
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
