import { describe, expect, it, vi } from 'vitest'
import { createPlannerApi } from './plannerApi'

describe('Planner API boundary', () => {
  it('keeps explicit imports separate from ordinary workspace saves with the same versioned body', async () => {
    const workspace = { schemaVersion: 1 as const, revision: 7, plans: [] }
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(workspace)))
    const api = createPlannerApi(fetcher)
    await api.importWorkspace(workspace)
    await api.saveState(workspace)
    expect(fetcher.mock.calls.map(([endpoint]) => endpoint)).toEqual(['/api/state/import', '/api/state'])
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ cache: 'no-store', method: 'PUT', body: JSON.stringify(workspace) })
  })

  it('delegates auth to the shared fetch and preserves the exact run/key', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ correlationId: 'op' }), { status: 202 }))
    const api = createPlannerApi(fetcher)
    const command = { planId: 'p', swarmId: 's', runId: 'old', action: 'start' as const, idempotencyKey: 'same-key' }
    await api.control(command)
    expect(fetcher).toHaveBeenCalledWith('/api/integration/control', expect.objectContaining({ method: 'POST', body: JSON.stringify(command) }))
    await api.operation('p/a', 's/b', 'old+c', 'op/d')
    expect(fetcher.mock.calls[1][0]).toBe('/api/integration/operation?planId=p%2Fa&swarmId=s%2Fb&runId=old%2Bc&correlationId=op%2Fd')
  })

  it('preserves the server error status without returning an empty successful snapshot', async () => {
    const api = createPlannerApi(vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Denied by PH' }), { status: 403 })))
    await expect(api.execution('p')).rejects.toMatchObject({ status: 403, message: 'Denied by PH' })
  })
})
