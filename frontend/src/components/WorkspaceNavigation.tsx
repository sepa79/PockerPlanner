import { NavigationItem, NavigationRail } from '@pockethive/ui'
import type { ViewMode } from '../api/types'

const modes: { id: ViewMode; label: string; icon: string }[] = [
  { id: 'plan', label: 'Plan', icon: '▤' }, { id: 'execution', label: 'Execution', icon: '▷' }, { id: 'mixed', label: 'Mixed', icon: '▱' },
]

export function WorkspaceNavigation({ mode, expanded, onExpandedChange, onModeChange, locked }: {
  mode: ViewMode; expanded: boolean; onExpandedChange: (expanded: boolean) => void; onModeChange: (mode: ViewMode) => void; locked: boolean
}) {
  return <NavigationRail expanded={expanded} onExpandedChange={onExpandedChange} label="Workspace views" expandLabel="Expand view sidebar" collapseLabel="Collapse view sidebar">
    {modes.map(item => <NavigationItem key={item.id} label={item.label} expanded={expanded} icon={<span className="pp-nav-icon" aria-hidden="true">{item.icon}</span>}>
      {presentation => <button {...presentation} type="button" aria-current={mode === item.id ? 'page' : undefined} aria-pressed={mode === item.id} disabled={locked} onClick={() => onModeChange(item.id)} />}
    </NavigationItem>)}
  </NavigationRail>
}
