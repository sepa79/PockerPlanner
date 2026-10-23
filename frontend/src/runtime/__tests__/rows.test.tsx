import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionRows, type ExecutionRowsProps } from '../ExecutionRows'
import { MixedRuns } from '../MixedRuns'
import { planFixture, runFixture, snapshotFixture } from './fixtures'

function fixture(overrides: Partial<ExecutionRowsProps> = {}) {
  const props: ExecutionRowsProps = { plan: planFixture(), snapshot: snapshotFixture(), outdated: false, error: '', pending: false,
    authenticated: true, collapsed: new Set(), onToggleStream: vi.fn(), onEditActivity: vi.fn(), onSelectRun: vi.fn(), ...overrides }
  return { props, ...render(<ExecutionRows {...props} />) }
}

describe('execution hierarchy', () => {
  it('preserves shared associations and operator progress without inventing phases or changing plan data', () => {
    const plan = planFixture()
    const before = JSON.stringify(plan)
    const view = fixture({ plan })
    expect(screen.getAllByRole('button', { name: /shared · Stopped/ })).toHaveLength(3)
    expect(screen.getAllByText('Shared · 3 Activities')).toHaveLength(3)
    expect(screen.getAllByText(/Phase not recorded/)).toHaveLength(3)
    expect(screen.getByText(/Plan blocked/)).toBeVisible()
    expect(screen.getByText('13%')).toBeVisible()
    expect(screen.getByText('25%')).toBeVisible()
    expect(screen.getAllByText('100%')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^old ·/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Minimal' }))
    expect(view.props.onEditActivity).toHaveBeenCalledWith('minimal')
    fireEvent.click(screen.getAllByRole('button', { name: /shared · Stopped/ })[0])
    expect(view.props.onSelectRun).toHaveBeenCalledWith(view.props.snapshot!.runs[0])
    expect(JSON.stringify(plan)).toBe(before)
  })
  it('retains fold, history and keyboard focus through polls, resetting them for a different plan', () => {
    const view = fixture()
    const history = screen.getByRole('checkbox', { name: 'Show run history' })
    fireEvent.click(history)
    expect(screen.getByRole('button', { name: /^old · Not current/ })).toBeVisible()
    const fold = screen.getByRole('button', { name: 'Collapse runs for Minimal' })
    fireEvent.click(fold)
    fold.focus()
    view.rerender(<ExecutionRows {...view.props} snapshot={{ ...snapshotFixture(), revision: 2 }} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(fold).toHaveFocus()
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    view.rerender(<ExecutionRows {...view.props} plan={{ ...view.props.plan, id: 'other' }} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Collapse runs for Minimal' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /^old ·/ })).toBeNull()
  })
  it('deduplicates a collapsed Stream summary and delegates Stream collapse to its parent', () => {
    const view = fixture({ collapsed: new Set(['one']) })
    const stream = screen.getByRole('region', { name: 'One' })
    expect(within(stream).getAllByRole('button', { name: /shared · Stopped/ })).toHaveLength(1)
    const toggle = within(stream).getByRole('button', { name: /One/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(view.props.onToggleStream).toHaveBeenCalledWith('one')
  })
  it('keeps unresolved references, capped listing warnings and escaped untrusted names visible', () => {
    const plan = planFixture()
    plan.streams[0].name = '<img src=x onerror="bad()">'
    const snapshot = snapshotFixture()
    snapshot.runs[0].swarmId = '<script>bad()</script>'
    snapshot.runs[0].runtime!.id = snapshot.runs[0].swarmId
    snapshot.runs.push({ ...runFixture(), activityIds: ['deleted'], unresolvedActivityTags: ['missing'] })
    snapshot.limitReached = true
    const { container } = fixture({ plan, snapshot, outdated: true, error: 'PH offline' })
    expect(container.querySelector('script, img')).toBeNull()
    expect(screen.getByText(plan.streams[0].name)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Unresolved Activity references' })).toBeVisible()
    expect(screen.getByText(/5,000-run listing limit/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('last observation shown; data is outdated. PH offline')
    expect(screen.getAllByText('Status outdated').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.pp-runtime-tps b')).not.toHaveLength(0)
    expect([...container.querySelectorAll('.pp-runtime-tps b')].every(element => element.textContent === '—')).toBe(true)
  })
  it('never displays protected observations for an unauthenticated viewer', () => {
    fixture({ authenticated: false })
    expect(screen.getByText(/Sign in with PocketHive/)).toBeVisible()
    expect(screen.queryByText('shared')).toBeNull()
  })
  it('exposes loading and explicit no-snapshot failures', () => {
    const view = fixture({ snapshot: null, pending: true })
    expect(screen.getByRole('status')).toHaveTextContent('Loading PocketHive execution')
    view.rerender(<ExecutionRows {...view.props} pending={false} error="PH unavailable" />)
    expect(screen.getByRole('status')).toHaveTextContent('PH unavailable')
  })
})

describe('Mixed run attachments', () => {
  it('shows current exact references without task frames, deduplicating Stream associations', () => {
    const plan = planFixture()
    const runs = snapshotFixture().runs
    const onSelectRun = vi.fn()
    const view = render(<MixedRuns {...{ plan, runs, onSelectRun }} outdated={false} activityId="minimal" />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(view.container.querySelectorAll('.bar')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelectRun).toHaveBeenCalledWith(runs[0])
    view.rerender(<MixedRuns {...{ plan, runs, onSelectRun }} outdated={false} streamId="one" />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    view.rerender(<MixedRuns {...{ plan, runs, onSelectRun }} outdated={false} activityId="missing" />)
    expect(view.container).toBeEmptyDOMElement()
  })
  it('fails explicitly for ambiguous or missing scope', () => {
    const props = { plan: planFixture(), runs: [], outdated: false, onSelectRun: vi.fn() }
    expect(() => render(<MixedRuns {...props} />)).toThrow('exactly one')
    expect(() => render(<MixedRuns {...props} activityId="minimal" streamId="one" />)).toThrow('exactly one')
  })
})
