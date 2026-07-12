import { useState } from 'react'
import { toast } from 'sonner'
import type { Store } from '../store'
import type { StepType, Workflow, WorkflowStep } from '../types'
import { SUGGESTED_EVENT_TYPES, eventMeta } from '../constants'
import { EventIcon } from '../components/ui-kit'
import type { ComponentType } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
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
import { Field, PillToggle } from './Cameras'
import { cn } from '@/lib/utils'
import {
  Plus,
  Trash2,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Pencil,
  Play,
  Bot,
  Plug,
  Split,
  Volume2,
  Wrench,
} from 'lucide-react'

type StepIcon = ComponentType<{ className?: string; size?: number | string }>

const STEP_TYPES: { id: StepType; label: string; icon: StepIcon }[] = [
  { id: 'h_agent', label: 'H Agent', icon: Bot },
  { id: 'mcp', label: 'MCP tool', icon: Wrench },
  { id: 'composio', label: 'Composio', icon: Plug },
  { id: 'condition', label: 'Condition', icon: Split },
  { id: 'voice', label: 'Voice', icon: Volume2 },
]

const STEP_META = Object.fromEntries(STEP_TYPES.map((s) => [s.id, s])) as Record<
  StepType,
  { id: StepType; label: string; icon: StepIcon }
>

const H_TASKS = ['google_form', 'ticket', 'custom_url']
// Preset agents from the H console (platform.hcompany.ai/agents). Custom
// agents you build there can be referenced by name via the "custom" option.
const H_AGENTS = [
  { id: 'h/web-surfer-pro', hint: 'Visual — clicks, forms, dynamic apps' },
  { id: 'h/web-surfer-flash', hint: 'Visual — faster/cheaper' },
  { id: 'h/web-scraper-pro', hint: 'Textual — reading-heavy pages' },
  { id: 'h/web-scraper-flash', hint: 'Textual — faster/cheaper' },
  { id: 'h/deep-search-pro', hint: 'Research — cited multi-source answer' },
]
const COMPOSIO_ACTIONS = ['slack_message', 'drive_upload', 'sheets_append']

const TEMPLATE_VARS =
  '{{event.event_type}} {{event.location}} {{event.confidence}} ' +
  '{{event.timestamp}} {{event.snapshot_url}} {{event.payload.count}} {{event.payload.detail}}'

let stepSeq = 0
const newStepId = () => `s_${Date.now().toString(36)}${(stepSeq++).toString(36)}`

function defaultConfig(type: StepType): Record<string, unknown> {
  switch (type) {
    case 'h_agent':
      return { agent: 'h/web-surfer-flash', task: 'google_form', url: '', instructions: '' }
    case 'composio':
      return { action: 'slack_message', channel: '', text: '' }
    case 'condition':
      return { expression: 'payload.count > 20' }
    case 'voice':
      return { text: '' }
    case 'mcp':
      return { server_url: '', tool: '', arguments: {} }
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

  const runTest = async (id: string, name: string) => {
    const runId = await store.testWorkflow(id)
    if (runId) {
      toast.success(`Triggered "${name || 'workflow'}"`, {
        description: 'Watch it execute on the Runs page.',
      })
    } else {
      toast.error('Could not trigger. Backend offline.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {store.backendOnline === false && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          Automation backend unreachable. Editing local copies. Start it with{' '}
          <code className="rounded bg-background/50 px-1">uvicorn main:app --port 8000</code> then
          use Reset demo to sync.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">Workflows</h2>
          <span className="text-sm text-muted-foreground">detection → ordered action steps</span>
        </div>
        <Button
          className="gap-1.5"
          onClick={() => setEditing({ wf: blankWorkflow(), isNew: true })}
        >
          <Plus className="size-4" /> New workflow
        </Button>
      </div>

      {store.workflows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No workflows yet. Create one to turn detections into agent + Composio actions.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {store.workflows.map((wf) => {
            const m = eventMeta(wf.trigger.event_type)
            return (
              <Card key={wf.id}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{wf.name || 'Untitled workflow'}</h3>
                    <Switch
                      checked={wf.enabled}
                      onCheckedChange={() => store.toggleWorkflow(wf.id)}
                      aria-label="Toggle workflow"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge
                      variant="outline"
                      className="gap-1"
                      style={{ color: m.color, borderColor: `${m.color}40` }}
                    >
                      <EventIcon type={wf.trigger.event_type} className="size-3.5" /> {m.label}
                    </Badge>
                    {wf.trigger.zone && <Badge variant="outline">{wf.trigger.zone}</Badge>}
                    <Badge variant="outline">≥ {Math.round(wf.trigger.min_confidence * 100)}%</Badge>
                    <Badge variant="outline">{wf.trigger.cooldown_sec}s cooldown</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {wf.steps.map((s, i) => {
                      const StepIco = STEP_META[s.type]?.icon
                      return (
                        <span key={s.id} className="flex items-center gap-1.5">
                          {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                          <Badge variant="secondary" className="gap-1">
                            {StepIco && <StepIco className="size-3.5" />} {stepSummary(s)}
                          </Badge>
                        </span>
                      )
                    })}
                  </div>

                  <Separator />

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setEditing({ wf: clone(wf), isNew: false })}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="mustard"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => runTest(wf.id, wf.name)}
                      disabled={!store.backendOnline}
                      title={store.backendOnline ? 'Fire a synthetic event' : 'Backend offline'}
                    >
                      <Play className="size-3.5" /> Test
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      onClick={() => store.removeWorkflow(wf.id)}
                      aria-label="Delete workflow"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {editing && (
        <EditorDialog
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
  if (s.type === 'mcp') return `MCP: ${(s.config.tool as string) || 'tool'}`
  if (s.type === 'composio') return String(s.config.action ?? 'composio')
  if (s.type === 'condition') return 'if …'
  return 'voice'
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function EditorDialog({
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
  // Which node the right pane edits: 'trigger' or a step id.
  const [selected, setSelected] = useState<string>('trigger')
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

  const addStep = () => {
    const id = newStepId()
    setWf((w) => ({
      ...w,
      steps: [...w.steps, { id, type: 'composio', config: defaultConfig('composio') }],
    }))
    setSelected(id)
  }

  const removeStep = (id: string) => {
    setWf((w) => ({ ...w, steps: w.steps.filter((s) => s.id !== id) }))
    setSelected((sel) => (sel === id ? 'trigger' : sel))
  }

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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle>{isNew ? 'New workflow' : 'Edit workflow'}</DialogTitle>
          <DialogDescription>
            Click a node to edit it. The engine runs the steps top to bottom when a matching event fires.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[66vh] grid-cols-[minmax(0,300px)_1fr] divide-x">
          {/* Left: visual flow rail */}
          <div className="overflow-y-auto p-5">
            <Field label="Name">
              <Input
                value={wf.name}
                onChange={(e) => setWf((w) => ({ ...w, name: e.target.value }))}
                placeholder="e.g. Spill → incident report"
                autoFocus
              />
            </Field>

            <div className="mt-5 flex flex-col">
              {/* Trigger node */}
              <FlowNode
                selected={selected === 'trigger'}
                onClick={() => setSelected('trigger')}
                icon={<EventIcon type={wf.trigger.event_type} className="size-4" />}
                color={eventMeta(wf.trigger.event_type).color}
                kicker="WHEN"
                title={
                  wf.trigger.event_type === '*'
                    ? 'Any event'
                    : eventMeta(wf.trigger.event_type).label
                }
                sub={`${wf.trigger.zone ?? 'any zone'} · ≥${Math.round(
                  wf.trigger.min_confidence * 100,
                )}%`}
              />

              {wf.steps.map((step, idx) => {
                const meta = STEP_META[step.type]
                const StepIco = meta?.icon ?? Bot
                return (
                  <div key={step.id} className="flex flex-col">
                    <Connector />
                    <FlowNode
                      selected={selected === step.id}
                      onClick={() => setSelected(step.id)}
                      icon={<StepIco className="size-4" />}
                      kicker={idx === 0 ? 'THEN' : 'AND'}
                      title={`${idx + 1}. ${meta?.label ?? step.type}`}
                      sub={stepSummary(step)}
                    />
                  </div>
                )
              })}

              <Connector />
              <button
                type="button"
                onClick={addStep}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <Plus className="size-4" /> Add step
              </button>
            </div>
          </div>

          {/* Right: config for the selected node */}
          <div className="overflow-y-auto p-5">
            {selected === 'trigger' ? (
              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold">Trigger</h3>
                <div className="flex flex-col gap-2">
                  <Label>Trigger event</Label>
                  <div className="flex flex-wrap gap-1.5">
                    <PillToggle
                      selected={wf.trigger.event_type === '*'}
                      onClick={() => setTrigger({ event_type: '*' })}
                    >
                      <EventIcon type="*" className="size-3.5" /> Any event
                    </PillToggle>
                    {[...new Set([...SUGGESTED_EVENT_TYPES, wf.trigger.event_type])]
                      .filter((t) => t && t !== '*')
                      .map((t) => (
                        <PillToggle
                          key={t}
                          selected={wf.trigger.event_type === t}
                          onClick={() => setTrigger({ event_type: t })}
                        >
                          <EventIcon type={t} className="size-3.5" /> {eventMeta(t).label}
                        </PillToggle>
                      ))}
                  </div>
                  <Input
                    value={wf.trigger.event_type === '*' ? '' : wf.trigger.event_type}
                    onChange={(e) => {
                      const slug = e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '')
                      setTrigger({ event_type: slug || '*' })
                    }}
                    placeholder="or type a custom event, e.g. blocked_exit"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Event types are open-ended. Type any concern the perception
                    model can surface, or match every event.
                  </p>
                </div>
                <Field label="Zone filter (optional)">
                  <Input
                    value={wf.trigger.zone ?? ''}
                    onChange={(e) => setTrigger({ zone: e.target.value.trim() || undefined })}
                    placeholder="any zone"
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <Label>Min confidence, {Math.round(wf.trigger.min_confidence * 100)}%</Label>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[wf.trigger.min_confidence]}
                    onValueChange={([v]) => setTrigger({ min_confidence: v })}
                  />
                </div>
                <Field label="Cooldown (seconds)" hint="At most one run per (workflow, zone) per window.">
                  <Input
                    type="number"
                    min={0}
                    value={wf.trigger.cooldown_sec}
                    onChange={(e) =>
                      setTrigger({ cooldown_sec: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                </Field>
              </div>
            ) : (
              (() => {
                const idx = wf.steps.findIndex((s) => s.id === selected)
                const step = wf.steps[idx]
                if (!step) return null
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Step {idx + 1}</h3>
                      <div className="flex items-center">
                        <Button variant="ghost" size="icon" className="size-7"
                          onClick={() => moveStep(idx, -1)} disabled={idx === 0} aria-label="Move up">
                          <ChevronUp className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7"
                          onClick={() => moveStep(idx, 1)} disabled={idx === wf.steps.length - 1} aria-label="Move down">
                          <ChevronDown className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeStep(step.id)} disabled={wf.steps.length === 1} aria-label="Remove step">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {STEP_TYPES.map((st) => {
                        const StepIco = st.icon
                        return (
                          <PillToggle key={st.id} selected={step.type === st.id}
                            onClick={() => changeStepType(step.id, st.id)}>
                            <StepIco className="size-3.5" /> {st.label}
                          </PillToggle>
                        )
                      })}
                    </div>
                    <Separator />
                    <StepConfig step={step} onConfig={(k, v) => setStepConfig(step.id, k, v)} />
                  </div>
                )
              })()
            )}
          </div>
        </div>

        <DialogFooter className="border-t p-5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => valid && onSave(wf)}>
            {isNew ? 'Create workflow' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Connector() {
  return <div className="ml-[27px] h-4 w-px bg-border" aria-hidden />
}

function FlowNode({
  selected,
  onClick,
  icon,
  color,
  kicker,
  title,
  sub,
}: {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  color?: string
  kicker: string
  title: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border p-3 text-left transition',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
          : 'bg-card/50 hover:border-primary/40',
      )}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"
        style={color ? { color } : undefined}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {kicker}
        </div>
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
    </button>
  )
}

function McpConfig({
  step,
  onConfig,
}: {
  step: WorkflowStep
  onConfig: (key: string, value: unknown) => void
}) {
  const cfg = step.config as Record<string, unknown>
  // Local text state for the arguments JSON so typing invalid intermediate
  // JSON doesn't get wiped; we push a parsed object up only when it's valid.
  const [argsText, setArgsText] = useState(() =>
    JSON.stringify(cfg.arguments ?? {}, null, 2),
  )
  const [argsError, setArgsError] = useState<string | null>(null)

  const onArgs = (text: string) => {
    setArgsText(text)
    try {
      const parsed = text.trim() ? JSON.parse(text) : {}
      onConfig('arguments', parsed)
      setArgsError(null)
    } catch {
      setArgsError('Invalid JSON — fix before saving')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="MCP server URL"
        hint="Any MCP server (Composio toolkit URL, a Google MCP, your own). The engine calls it; H's agent isn't involved."
      >
        <Input
          value={(cfg.server_url as string) ?? ''}
          onChange={(e) => onConfig('server_url', e.target.value)}
          placeholder="https://…/mcp"
        />
      </Field>
      <Field label="Tool name" hint="From the server's tools/list, e.g. GOOGLESHEETS_APPEND_ROW">
        <Input
          value={(cfg.tool as string) ?? ''}
          onChange={(e) => onConfig('tool', e.target.value)}
          placeholder="sheets_append_row"
        />
      </Field>
      <div className="flex flex-col gap-2">
        <Label>Arguments (JSON)</Label>
        <Textarea
          value={argsText}
          onChange={(e) => onArgs(e.target.value)}
          rows={5}
          className="font-mono text-xs"
          placeholder={'{\n  "spreadsheet": "incidents",\n  "values": ["{{event.location}}"]\n}'}
        />
        {argsError ? (
          <span className="text-xs text-destructive">{argsError}</span>
        ) : (
          <TemplateHint />
        )}
      </div>
    </div>
  )
}

function TemplateHint() {
  return (
    <span className={cn('block text-xs text-muted-foreground')}>
      Variables: <code className="text-[11px]">{TEMPLATE_VARS}</code>
    </span>
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
    const agent = cfg.agent ?? 'h/web-surfer-flash'
    const isPreset = H_AGENTS.some((a) => a.id === agent)
    return (
      <div className="flex flex-col gap-4">
        <Field label="Agent" hint="Which H agent runs this step. Presets from the H console, or a custom one you built there.">
          <Select
            value={isPreset ? agent : '__custom__'}
            onValueChange={(v) => onConfig('agent', v === '__custom__' ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {H_AGENTS.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.id} — {a.hint}
                </SelectItem>
              ))}
              <SelectItem value="__custom__">Custom agent…</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {!isPreset && (
          <Field label="Custom agent name" hint="Name of an agent you built at platform.hcompany.ai/agents">
            <Input
              value={agent}
              onChange={(e) => onConfig('agent', e.target.value)}
              placeholder="h/my-incident-filer"
            />
          </Field>
        )}
        <Field label="Task kind">
          <Select value={cfg.task ?? 'google_form'} onValueChange={(v) => onConfig('task', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {H_TASKS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Target URL">
          <Input
            value={cfg.url ?? ''}
            onChange={(e) => onConfig('url', e.target.value)}
            placeholder="https://forms.gle/…"
          />
        </Field>
        <div className="flex flex-col gap-2">
          <Label>Instructions</Label>
          <Textarea
            value={cfg.instructions ?? ''}
            onChange={(e) => onConfig('instructions', e.target.value)}
            placeholder="Fill the incident form: location={{event.location}}…"
          />
          <TemplateHint />
        </div>
      </div>
    )
  }

  if (step.type === 'composio') {
    const action = cfg.action ?? 'slack_message'
    return (
      <div className="flex flex-col gap-4">
        <Field label="Action">
          <Select value={action} onValueChange={(v) => onConfig('action', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPOSIO_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {action === 'slack_message' && (
          <>
            <Field label="Channel">
              <Input
                value={cfg.channel ?? ''}
                onChange={(e) => onConfig('channel', e.target.value)}
                placeholder="#facilities-alerts"
              />
            </Field>
            <div className="flex flex-col gap-2">
              <Label>Message</Label>
              <Textarea
                value={cfg.text ?? ''}
                onChange={(e) => onConfig('text', e.target.value)}
                placeholder="{{event.event_type}} in {{event.location}}"
              />
              <TemplateHint />
            </div>
          </>
        )}
        {action === 'drive_upload' && (
          <>
            <Field label="File">
              <Input
                value={cfg.file ?? ''}
                onChange={(e) => onConfig('file', e.target.value)}
                placeholder="{{event.snapshot_url}}"
              />
            </Field>
            <Field label="Folder">
              <Input
                value={cfg.folder ?? ''}
                onChange={(e) => onConfig('folder', e.target.value)}
                placeholder="incidents/"
              />
            </Field>
          </>
        )}
        {action === 'sheets_append' && (
          <>
            <Field label="Spreadsheet ID">
              <Input
                value={cfg.spreadsheet_id ?? ''}
                onChange={(e) => onConfig('spreadsheet_id', e.target.value)}
                placeholder="1AbC…"
              />
            </Field>
            <Field label="Sheet name">
              <Input
                value={cfg.sheet_name ?? ''}
                onChange={(e) => onConfig('sheet_name', e.target.value)}
                placeholder="Sheet1"
              />
            </Field>
          </>
        )}
      </div>
    )
  }

  if (step.type === 'condition') {
    return (
      <Field
        label="Expression"
        hint="Grammar: <event-path> <op> <value>. Ops: > < >= <= == !="
      >
        <Input
          value={cfg.expression ?? ''}
          onChange={(e) => onConfig('expression', e.target.value)}
          placeholder="payload.count > 20"
        />
      </Field>
    )
  }

  if (step.type === 'mcp') {
    return <McpConfig step={step} onConfig={onConfig} />
  }

  // voice
  return (
    <div className="flex flex-col gap-2">
      <Label>Text to speak</Label>
      <Textarea
        value={cfg.text ?? ''}
        onChange={(e) => onConfig('text', e.target.value)}
        placeholder="Spill detected in {{event.location}}"
      />
      <TemplateHint />
    </div>
  )
}
