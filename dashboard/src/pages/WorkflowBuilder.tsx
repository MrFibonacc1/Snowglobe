import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
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
import { api } from '../api'
import type { AppEvent } from '../types'
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
  Zap,
} from 'lucide-react'

type StepIcon = ComponentType<{ className?: string; size?: number | string }>

const STEP_TYPES: { id: StepType; label: string; icon: StepIcon }[] = [
  { id: 'h_agent', label: 'H Agent', icon: Bot },
  { id: 'mcp', label: 'MCP tool', icon: Wrench },
  { id: 'inventory_adjust', label: 'Inventory', icon: Wrench },
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
    case 'inventory_adjust':
      return { sku: 'front-shelf-item', delta: -1 }
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
  const [sendingEvent, setSendingEvent] = useState(false)

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
          variant="secondary"
          className="gap-1.5"
          onClick={() => setSendingEvent(true)}
          disabled={!store.backendOnline}
          title={store.backendOnline ? 'Emit a test event' : 'Backend offline'}
        >
          <Zap className="size-4" /> Send test event
        </Button>
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

      {sendingEvent && <SendTestEventDialog onClose={() => setSendingEvent(false)} />}
    </div>
  )
}

function SendTestEventDialog({ onClose }: { onClose: () => void }) {
  const [eventType, setEventType] = useState('spill')
  const [zone, setZone] = useState('zone_a')
  const [confidence, setConfidence] = useState(0.9)
  const [count, setCount] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = eventType.trim().length > 0 && zone.trim().length > 0

  const send = async () => {
    setBusy(true)
    const n = Number(count)
    const payload: Record<string, unknown> = count.trim() && !Number.isNaN(n)
      ? { count: n }
      : { detail: `${eventMeta(eventType).label} detected (test)` }
    const event: AppEvent = {
      event_id: `evt_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      event_type: eventType.trim(),
      timestamp: new Date().toISOString(),
      confidence,
      location: zone.trim(),
      payload,
    }
    try {
      const res = await api.postEvent(event)
      const started = res.runs_started?.length ?? 0
      if (started > 0) {
        toast.success(`Event sent — triggered ${started} workflow${started === 1 ? '' : 's'}`, {
          description: 'Watch them run on the Runs page.',
        })
      } else {
        toast.info('Event sent — no workflows matched', {
          description: 'Check the trigger type / zone / confidence.',
        })
      }
      onClose()
    } catch {
      toast.error('Could not send — backend offline')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send test event</DialogTitle>
          <DialogDescription>
            Emit an event as if a camera detected it — every matching workflow fires
            (respecting zone, confidence, and cooldown).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label>Event type</Label>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...SUGGESTED_EVENT_TYPES, eventType])].filter(Boolean).map((t) => (
                <PillToggle key={t} selected={eventType === t} onClick={() => setEventType(t)}>
                  <EventIcon type={t} className="size-3.5" /> {eventMeta(t).label}
                </PillToggle>
              ))}
            </div>
            <Input
              value={eventType}
              onChange={(e) =>
                setEventType(
                  e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
                )
              }
              placeholder="or a custom type, e.g. foot_traffic"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Zone">
              <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone_a" />
            </Field>
            <Field label="Count (optional)" hint="for count-type events">
              <Input
                type="number"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                placeholder="e.g. 25"
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Confidence, {Math.round(confidence * 100)}%</Label>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[confidence]}
              onValueChange={([v]) => setConfidence(v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={send} className="gap-1.5">
            <Zap className="size-4" /> {busy ? 'Sending…' : 'Send event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function stepSummary(s: WorkflowStep): string {
  if (s.type === 'h_agent') return `H: ${(s.config.task as string) ?? 'agent'}`
  if (s.type === 'mcp') return `MCP: ${(s.config.tool as string) || 'tool'}`
  if (s.type === 'composio') return String(s.config.action ?? 'composio')
  if (s.type === 'condition') return 'if …'
  if (s.type === 'inventory_adjust') return `Stock: ${String(s.config.sku ?? 'SKU')} ${Number(s.config.delta ?? -1)}`
  return 'voice'
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

// ---- React Flow canvas editor (n8n-style) --------------------------------
// Structure lives in the canvas: one 'trigger' node + one 'step' node per
// step, wired in a chain. Execution order = the connected path from trigger
// (engine runs a linear chain). Node.data holds the trigger/step config.

const NODE_DX = 240
const EDGE_OPTS = { animated: false, markerEnd: { type: MarkerType.ArrowClosed } }
const NODE_TYPES = { trigger: TriggerNode, step: StepNode }

function TriggerNode({ data, selected }: NodeProps) {
  const t = (data as { trigger: Workflow['trigger'] }).trigger
  const meta = eventMeta(t.event_type)
  return (
    <div
      className={cn(
        'w-52 rounded-lg border bg-card p-3 shadow-sm transition',
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted" style={{ color: meta.color }}>
          <EventIcon type={t.event_type} className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">When</div>
          <div className="truncate text-sm font-medium">
            {t.event_type === '*' ? 'Any event' : meta.label}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {t.zone ?? 'any zone'} · ≥{Math.round(t.min_confidence * 100)}%
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function StepNode({ data, selected }: NodeProps) {
  const step = (data as { step: WorkflowStep }).step
  const meta = STEP_META[step.type]
  const Ico = meta?.icon ?? Bot
  return (
    <div
      className={cn(
        'w-52 rounded-lg border bg-card p-3 shadow-sm transition',
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Ico className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {meta?.label ?? step.type}
          </div>
          <div className="truncate text-sm font-medium">{stepSummary(step)}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function workflowToFlow(wf: Workflow): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: 'trigger', type: 'trigger', position: { x: 0, y: 100 }, deletable: false, data: { trigger: wf.trigger } },
    ...wf.steps.map(
      (s, i): Node => ({
        id: s.id,
        type: 'step',
        position: { x: (i + 1) * NODE_DX, y: 100 },
        data: { step: s },
      }),
    ),
  ]
  const chain = ['trigger', ...wf.steps.map((s) => s.id)]
  const edges: Edge[] = []
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push({ id: `e-${chain[i]}-${chain[i + 1]}`, source: chain[i], target: chain[i + 1], ...EDGE_OPTS })
  }
  return { nodes, edges }
}

function flowToSteps(nodes: Node[], edges: Edge[]): WorkflowStep[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, string>()
  for (const e of edges) if (!out.has(e.source)) out.set(e.source, e.target)
  const order: string[] = []
  const seen = new Set<string>()
  let cur = out.get('trigger')
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    if (byId.get(cur)!.type === 'step') order.push(cur)
    cur = out.get(cur)
  }
  // Keep any disconnected step nodes so nothing is silently lost.
  for (const n of nodes) if (n.type === 'step' && !seen.has(n.id)) order.push(n.id)
  return order.map((id) => (byId.get(id)!.data as { step: WorkflowStep }).step)
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
  const init = useMemo(() => workflowToFlow(initial), [initial])
  const [nodes, setNodes, onNodesChange] = useNodesState(init.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(init.edges)
  const [name, setName] = useState(initial.name)
  const [selected, setSelected] = useState<string>('trigger')

  const hasSteps = nodes.some((n) => n.type === 'step')
  const valid = name.trim().length > 0 && hasSteps

  const updateNodeData = useCallback(
    (id: string, updater: (d: Record<string, unknown>) => Record<string, unknown>) =>
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: updater(n.data) } : n))),
    [setNodes],
  )

  const setTrigger = (patch: Partial<Workflow['trigger']>) =>
    updateNodeData('trigger', (d) => ({
      trigger: { ...(d as { trigger: Workflow['trigger'] }).trigger, ...patch },
    }))

  const setStepConfig = (id: string, key: string, value: unknown) =>
    updateNodeData(id, (d) => {
      const s = (d as { step: WorkflowStep }).step
      return { step: { ...s, config: { ...s.config, [key]: value } } }
    })

  const changeStepType = (id: string, type: StepType) =>
    updateNodeData(id, (d) => {
      const s = (d as { step: WorkflowStep }).step
      return { step: { ...s, type, config: defaultConfig(type) } }
    })

  const onConnect = useCallback(
    (c: Connection) =>
      // Single chain: one outgoing per node, one incoming per node.
      setEdges((eds) =>
        addEdge(
          { ...c, ...EDGE_OPTS },
          eds.filter((e) => e.source !== c.source && e.target !== c.target),
        ),
      ),
    [setEdges],
  )

  const bridge = useCallback(
    (id: string) =>
      setEdges((eds) => {
        const inc = eds.find((e) => e.target === id)
        const out = eds.find((e) => e.source === id)
        let next = eds.filter((e) => e.source !== id && e.target !== id)
        if (inc && out) {
          next = addEdge({ id: `e-${inc.source}-${out.target}`, source: inc.source, target: out.target, ...EDGE_OPTS }, next)
        }
        return next
      }),
    [setEdges],
  )

  const addStep = (type: StepType) => {
    const id = newStepId()
    const steps = flowToSteps(nodes, edges)
    const tailId = steps.length ? steps[steps.length - 1].id : 'trigger'
    const maxX = Math.max(0, ...nodes.map((n) => n.position.x))
    setNodes((nds) => [
      ...nds,
      { id, type: 'step', position: { x: maxX + NODE_DX, y: 100 }, data: { step: { id, type, config: defaultConfig(type) } } },
    ])
    setEdges((eds) => addEdge({ id: `e-${tailId}-${id}`, source: tailId, target: id, ...EDGE_OPTS }, eds))
    setSelected(id)
  }

  const removeStep = (id: string) => {
    bridge(id)
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setSelected('trigger')
  }

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((d) => d.id !== 'trigger' && bridge(d.id))
      setSelected((sel) => (deleted.some((d) => d.id === sel) ? 'trigger' : sel))
    },
    [bridge],
  )

  const save = () => {
    const triggerData = (nodes.find((n) => n.id === 'trigger')!.data as {
      trigger: Workflow['trigger']
    }).trigger
    onSave({ ...initial, name: name.trim(), trigger: triggerData, steps: flowToSteps(nodes, edges) })
  }

  const triggerData = (nodes.find((n) => n.id === 'trigger')?.data as
    | { trigger: Workflow['trigger'] }
    | undefined)?.trigger
  const selNode = nodes.find((n) => n.id === selected)
  const selStep =
    selNode && selNode.type === 'step'
      ? (selNode.data as { step: WorkflowStep }).step
      : null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88vh] w-[96vw] max-w-[1180px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px]">
        <DialogHeader className="border-b p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <DialogTitle>{isNew ? 'New workflow' : 'Edit workflow'}</DialogTitle>
              <DialogDescription>
                Drag nodes, connect them, click a node to configure. Runs along the connected chain.
              </DialogDescription>
            </div>
            <Input
              className="max-w-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workflow name"
            />
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Canvas */}
          <div className="relative min-w-0 flex-1">
            <div className="absolute left-3 top-3 z-10">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5 shadow-sm"
                onClick={() => addStep('composio')}
              >
                <Plus className="size-4" /> Add step
              </Button>
            </div>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodesDelete={onNodesDelete}
              onNodeClick={(_, n) => setSelected(n.id)}
              defaultEdgeOptions={EDGE_OPTS}
              fitView
              fitViewOptions={{ padding: 0.35 }}
              onInit={(inst) => setTimeout(() => inst.fitView({ padding: 0.35 }), 90)}
            >
              <Background gap={22} size={1} color="var(--border)" />
              <Controls showInteractive={false} className="!shadow-none" />
            </ReactFlow>
          </div>

          {/* Config panel for the selected node */}
          <div className="w-[360px] shrink-0 overflow-y-auto border-l p-4">
            {selected === 'trigger' && triggerData ? (
              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold">Trigger</h3>
                <div className="flex flex-col gap-2">
                  <Label>Trigger event</Label>
                  <div className="flex flex-wrap gap-1.5">
                    <PillToggle selected={triggerData.event_type === '*'} onClick={() => setTrigger({ event_type: '*' })}>
                      <EventIcon type="*" className="size-3.5" /> Any event
                    </PillToggle>
                    {[...new Set([...SUGGESTED_EVENT_TYPES, triggerData.event_type])]
                      .filter((t) => t && t !== '*')
                      .map((t) => (
                        <PillToggle key={t} selected={triggerData.event_type === t} onClick={() => setTrigger({ event_type: t })}>
                          <EventIcon type={t} className="size-3.5" /> {eventMeta(t).label}
                        </PillToggle>
                      ))}
                  </div>
                  <Input
                    value={triggerData.event_type === '*' ? '' : triggerData.event_type}
                    onChange={(e) => {
                      // Preserve a trailing underscore while typing; trimming it on
                      // every keystroke turns `item_removed` into `itemremoved`.
                      const slug = e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+/, '')
                      setTrigger({ event_type: slug || '*' })
                    }}
                    placeholder="or type a custom event, e.g. blocked_exit"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Event types are open-ended. Type any concern the perception model can surface, or match every event.
                  </p>
                </div>
                <Field label="Zone filter (optional)">
                  <Input
                    value={triggerData.zone ?? ''}
                    onChange={(e) => setTrigger({ zone: e.target.value.trim() || undefined })}
                    placeholder="any zone"
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <Label>Min confidence, {Math.round(triggerData.min_confidence * 100)}%</Label>
                  <Slider min={0} max={1} step={0.05} value={[triggerData.min_confidence]} onValueChange={([v]) => setTrigger({ min_confidence: v })} />
                </div>
                <Field label="Cooldown (seconds)" hint="At most one run per (workflow, zone) per window.">
                  <Input
                    type="number"
                    min={0}
                    value={triggerData.cooldown_sec}
                    onChange={(e) => setTrigger({ cooldown_sec: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Field>
              </div>
            ) : selStep ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Step</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeStep(selStep.id)}
                    aria-label="Remove step"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STEP_TYPES.map((st) => {
                    const StepIco = st.icon
                    return (
                      <PillToggle key={st.id} selected={selStep.type === st.id} onClick={() => changeStepType(selStep.id, st.id)}>
                        <StepIco className="size-3.5" /> {st.label}
                      </PillToggle>
                    )
                  })}
                </div>
                <Separator />
                <StepConfig step={selStep} onConfig={(k, v) => setStepConfig(selStep.id, k, v)} />
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Select a node to edit it.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t p-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={save}>
            {isNew ? 'Create workflow' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  if (step.type === 'inventory_adjust') {
    return (
      <div className="flex flex-col gap-4">
        <Field label="SKU" hint="A persisted inventory item exposed by the automation API.">
          <Input value={cfg.sku ?? ''} onChange={(e) => onConfig('sku', e.target.value)} />
        </Field>
        <Field label="Quantity change" hint="Use -1 when one item leaves the shelf.">
          <Input
            type="number"
            value={cfg.delta ?? -1}
            onChange={(e) => onConfig('delta', Number(e.target.value))}
          />
        </Field>
      </div>
    )
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
