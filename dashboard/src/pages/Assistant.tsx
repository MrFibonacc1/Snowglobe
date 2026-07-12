import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Store } from '../store'
import type { Workflow, WorkflowStep } from '../types'
import { api } from '../api'
import { eventMeta } from '../constants'
import { EventIcon } from '../components/ui-kit'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Send, Loader2, ArrowRight, Bot, Plug, Split, Volume2, Wrench, Clock } from 'lucide-react'

type Draft = Workflow & { _valid?: boolean; _validation_error?: string }
type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; draft?: Draft; error?: string }

const EXAMPLES = [
  'When there is a spill, log the time and location to a Google Doc',
  'If a zone gets busy with more than 30 people, alert staff on Slack',
  "When it's quiet, have an agent research wholesale coffee prices",
  'On a safety violation, file an incident report in our portal',
]

const STEP_ICON: Record<string, typeof Bot> = {
  h_agent: Bot,
  composio: Plug,
  condition: Split,
  voice: Volume2,
  mcp: Wrench,
}

export function Assistant({ store, onNavigate }: { store: Store; onNavigate: (v: 'automations') => void }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const send = async (text: string) => {
    const description = text.trim()
    if (!description || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: description }])
    setBusy(true)
    try {
      const draft = await api.generateWorkflow(description)
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: 'Here’s a workflow for that — review and save it:', draft },
      ])
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          error: 'Could not generate — is the automation backend running? (needs the NVIDIA key for the AI, falls back to a keyword draft otherwise)',
        },
      ])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }))
    }
  }

  const createDraft = async (draft: Draft) => {
    // strip helper fields before saving
    const { _valid, _validation_error, ...wf } = draft
    void _valid
    void _validation_error
    await store.saveWorkflow(wf as Workflow, true)
    toast.success(`Created "${wf.name}"`, { description: 'Opening Workflows…' })
    onNavigate('automations')
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] w-full max-w-3xl flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-4 pt-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-6" />
            </div>
            <div>
              <h2 className="font-display text-xl">Describe an automation</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Tell me what should happen when the cameras detect something. I’ll build the
                workflow — including what to have the H Company agent do.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-2">
              {m.text && <div className="text-sm text-muted-foreground">{m.text}</div>}
              {m.error && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
                  {m.error}
                </div>
              )}
              {m.draft && <DraftCard draft={m.draft} onCreate={() => createDraft(m.draft!)} />}
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Designing the workflow…
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t pt-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          placeholder="e.g. When someone isn't wearing a hard hat, log it and message the safety channel…"
          className="min-h-[52px] resize-none"
          rows={2}
        />
        <Button onClick={() => send(input)} disabled={busy || !input.trim()} className="h-[52px] gap-1.5">
          <Send className="size-4" /> Send
        </Button>
      </div>
    </div>
  )
}

function DraftCard({ draft, onCreate }: { draft: Draft; onCreate: () => void }) {
  const m = eventMeta(draft.trigger.event_type)
  return (
    <Card className="max-w-[85%]">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{draft.name}</h3>
          {draft._valid === false && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700">
              needs a tweak
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.trigger.type === 'schedule' ? (
            <>
              <Badge variant="outline" className="gap-1">
                <Clock className="size-3.5" /> {draft.trigger.cron ?? 'schedule'}
              </Badge>
              <Badge variant="outline">last {draft.trigger.lookback_hours ?? 24}h</Badge>
              {draft.trigger.event_type && (
                <Badge variant="outline">{m.label}</Badge>
              )}
            </>
          ) : (
            <>
              <Badge
                variant="outline"
                className="gap-1"
                style={{ color: m.color, borderColor: `${m.color}40` }}
              >
                <EventIcon type={draft.trigger.event_type ?? '*'} className="size-3.5" />
                {draft.trigger.event_type === '*' ? 'Any event' : m.label}
              </Badge>
              {draft.trigger.zone && <Badge variant="outline">{draft.trigger.zone}</Badge>}
              <Badge variant="outline">≥ {Math.round((draft.trigger.min_confidence ?? 0.6) * 100)}%</Badge>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.steps.map((s: WorkflowStep, i) => {
            const Icon = STEP_ICON[s.type] ?? Bot
            return (
              <span key={s.id ?? i} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                <Badge variant="secondary" className="gap-1">
                  <Icon className="size-3.5" /> {stepLabel(s)}
                </Badge>
              </span>
            )
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={onCreate}>
            Create workflow
          </Button>
          <span className="text-xs text-muted-foreground">
            You can fine-tune it after in the builder.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function stepLabel(s: WorkflowStep): string {
  const c = s.config as Record<string, unknown>
  if (s.type === 'h_agent') return `H agent: ${(c.agent as string) ?? 'run'}`
  if (s.type === 'composio') return String(c.action ?? 'composio')
  if (s.type === 'condition') return `if ${String(c.expression ?? '…')}`
  if (s.type === 'mcp') return `MCP: ${(c.tool as string) ?? 'tool'}`
  return 'voice'
}
