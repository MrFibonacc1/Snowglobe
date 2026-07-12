import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  LayoutGrid,
  Camera,
  Plug,
  Zap,
  Activity,
  List,
  FlaskConical,
  Sparkles,
} from 'lucide-react'

export type View =
  | 'overview'
  | 'assistant'
  | 'cameras'
  | 'integrations'
  | 'automations'
  | 'runs'
  | 'events'
  | 'testing'

interface Props {
  view: View
  onChange: (v: View) => void
  counts: { cameras: number; integrations: number; automations: number }
}

const NAV: {
  id: View
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'assistant', label: 'AI Builder', icon: Sparkles },
  { id: 'cameras', label: 'Cameras', icon: Camera },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'automations', label: 'Workflows', icon: Zap },
  { id: 'runs', label: 'Runs', icon: Activity },
  { id: 'events', label: 'Event log', icon: List },
  { id: 'testing', label: 'Testing', icon: FlaskConical },
]

export function AppSidebar({ view, onChange, counts }: Props) {
  const countFor = (id: View) =>
    id === 'cameras'
      ? counts.cameras
      : id === 'integrations'
        ? counts.integrations
        : id === 'automations'
          ? counts.automations
          : undefined

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="leading-tight">
            <div className="font-display text-base font-medium tracking-tight">Snowglobe</div>
            <div className="text-xs text-muted-foreground">Console</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => {
                const c = countFor(n.id)
                const Icon = n.icon
                return (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton
                      isActive={view === n.id}
                      onClick={() => onChange(n.id)}
                      tooltip={n.label}
                    >
                      <Icon />
                      <span>{n.label}</span>
                    </SidebarMenuButton>
                    {c !== undefined && <SidebarMenuBadge>{c}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          Ambient perception → agentic action.
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
