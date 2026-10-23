import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { Activity } from '../api/types'
import { createExecutionDraft, changeExecution, resolveExecution, executionPreview, localTimes, offsetLabel } from './execution'

const now = '2026-10-19T12:00:00.000Z'
const base: Activity = { id: 'a', name: 'Activity', streamId: 's', typeId: 't', start: '2026-10-12', durationDays: 3, progress: 0, status: '', issueIds: [], jiraUrl: '' }

function inTimezone(timezone: string, run: () => void) {
  const previous = process.env.TZ
  process.env.TZ = timezone
  try { run() }
  finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

describe('pure execution draft in actual viewer timezones', () => {
  it('preserves unchanged instants, spellings and milliseconds across the repeated hour', () => {
    inTimezone('Europe/London', () => {
      const item = {...base, progress:100, startedAt:'2025-10-26T01:45:00.123+01:00', completedAt:'2025-10-26T01:15:00.456Z'}
      const draft = createExecutionDraft(item)
      assert.ok(draft.startedAt.value > draft.completedAt.value)
      assert.equal(resolveExecution(draft, item, now).valid, true)
      assert.deepEqual(resolveExecution(draft, item, now).actions, {})
      assert.equal(executionPreview(item, draft, now).startedAt, item.startedAt)
      assert.equal(executionPreview(item, draft, now).completedAt, item.completedAt)
    })
  })

  it('uses one prospective instant for Done followed later by Started, sending only intents', () => {
    inTimezone('Europe/London', () => {
      let draft = createExecutionDraft(base)
      draft = changeExecution(draft, base, {kind:'done'}, '2026-10-19T11:00:00Z')
      draft = changeExecution(draft, base, {kind:'started'}, now)
      assert.equal(resolveExecution(draft, base, now).valid, true)
      assert.deepEqual(resolveExecution(draft, base, now).actions, {started:true, done:true})
      assert.equal(executionPreview(base, draft, now).startedAt, now)
      assert.equal(executionPreview(base, draft, now).completedAt, now)
    })
  })

  it('rejects automatic Started after an explicitly backdated Done', () => {
    inTimezone('Europe/London', () => {
      let draft = changeExecution(createExecutionDraft(base), base, {kind:'done'}, now)
      draft = changeExecution(draft, base, {kind:'date',field:'completedAt',value:'2026-10-14T10:00'}, now)
      draft = changeExecution(draft, base, {kind:'started'}, now)
      assert.match(resolveExecution(draft, base, now).errors.completedAt ?? '', /cannot precede/)
      draft = changeExecution(draft, base, {kind:'date',field:'startedAt',value:'2026-10-13T10:00'}, now)
      assert.equal(resolveExecution(draft, base, now).valid, true)
      assert.equal(resolveExecution(draft, base, now).actions.startedAt, '2026-10-13T09:00:00.000Z')
    })
  })

  it('compares repeated-hour instants, not local clock labels, for future dates', () => {
    inTimezone('Europe/London', () => {
      const past = {...base, progress:50, startedAt:'2025-10-26T00:45:00Z'}
      const future = {...base, progress:50, startedAt:'2025-10-26T01:15:00Z'}
      assert.equal(resolveExecution(createExecutionDraft(past), past, '2025-10-26T01:15:00Z').valid, true)
      assert.match(resolveExecution(createExecutionDraft(future), future, '2025-10-26T00:45:00Z').errors.startedAt ?? '', /future/)
    })
  })

  it('retains the recorded occurrence for corrections on the same date', () => {
    inTimezone('Europe/London', () => {
      for (const [completedAt, expected, offset] of [['2025-10-26T00:50:00Z','2025-10-26T00:55:00.000Z','-60'], ['2025-10-26T01:50:00Z','2025-10-26T01:55:00.000Z','0']]) {
        const item = {...base, progress:100, startedAt:'2025-10-26T00:40:00Z', completedAt}
        const draft = changeExecution(createExecutionDraft(item), item, {kind:'date',field:'completedAt',value:'2025-10-26T01:55'}, now)
        assert.equal(draft.completedAt.offset, offset)
        assert.equal(resolveExecution(draft, item, now).actions.completedAt, expected)
        assert.equal(executionPreview(item, draft, now).completedAt, expected)
      }
    })
  })

  it('can change occurrence without changing the clock label, and restore the original instant', () => {
    inTimezone('Europe/London', () => {
      const item = {...base, progress:100, startedAt:'2025-10-26T00:40:00Z', completedAt:'2025-10-26T01:50:00.456Z'}
      let draft = changeExecution(createExecutionDraft(item), item, {kind:'offset',field:'completedAt',value:'-60'}, now)
      assert.equal(resolveExecution(draft, item, now).actions.completedAt, '2025-10-26T00:50:00.000Z')
      draft = changeExecution(draft, item, {kind:'offset',field:'completedAt',value:'0'}, now)
      assert.equal(executionPreview(item, draft, now).completedAt, item.completedAt)
      assert.deepEqual(resolveExecution(draft, item, now).actions, {})
    })
  })

  it('requires an explicit occurrence for new repeated times and never carries an offset across dates', () => {
    inTimezone('Europe/London', () => {
      let draft = changeExecution(createExecutionDraft(base), base, {kind:'started'}, now)
      draft = changeExecution(draft, base, {kind:'date',field:'startedAt',value:'2025-10-26T01:30'}, now)
      assert.match(resolveExecution(draft, base, now).errors.startedAt ?? '', /UTC offset/)
      draft = changeExecution(draft, base, {kind:'offset',field:'startedAt',value:'0'}, now)
      assert.equal(resolveExecution(draft, base, now).actions.startedAt, '2025-10-26T01:30:00.000Z')
      draft = changeExecution(draft, base, {kind:'date',field:'startedAt',value:'2026-06-01T10:00'}, now)
      assert.equal(resolveExecution(draft, base, now).actions.startedAt, '2026-06-01T09:00:00.000Z')
      draft = changeExecution(draft, base, {kind:'date',field:'startedAt',value:'2025-10-26T01:30'}, now)
      assert.match(resolveExecution(draft, base, now).errors.startedAt ?? '', /UTC offset/)
      const item = {...base, startedAt:'2025-10-25T09:00:00Z'}
      draft = changeExecution(createExecutionDraft(item), item, {kind:'date',field:'startedAt',value:'2025-10-26T01:30'}, now)
      assert.equal(draft.startedAt.offset, '')
    })
  })

  it('enforces future validation after choosing a later occurrence', () => {
    inTimezone('Europe/London', () => {
      const item = {...base, progress:50, startedAt:'2025-10-26T00:40:00Z'}
      let draft = changeExecution(createExecutionDraft(item), item, {kind:'date',field:'startedAt',value:'2025-10-26T01:30'}, now)
      assert.equal(resolveExecution(draft, item, '2025-10-26T00:45:00Z').valid, true)
      draft = changeExecution(draft, item, {kind:'offset',field:'startedAt',value:'0'}, now)
      assert.match(resolveExecution(draft, item, '2025-10-26T00:45:00Z').errors.startedAt ?? '', /future/)
    })
  })

  it('automatic actions need no occurrence even within the repeated hour', () => {
    inTimezone('Europe/London', () => {
      const instant = '2025-10-26T01:15:00.000Z'
      let draft = changeExecution(createExecutionDraft(base), base, {kind:'done'}, instant)
      draft = changeExecution(draft, base, {kind:'started'}, instant)
      assert.equal(resolveExecution(draft, base, instant).valid, true)
      assert.equal(executionPreview(base, draft, instant).completedAt, instant)
      assert.deepEqual(resolveExecution(draft, base, instant).actions, {started:true,done:true})
    })
  })

  it('rejects spring gaps and invalid calendar input instead of normalizing them', () => {
    inTimezone('Europe/London', () => {
      let draft = changeExecution(createExecutionDraft(base), base, {kind:'started'}, now)
      for (const value of ['2026-03-29T01:30','2026-02-30T10:00','2026-10-20T10:00','']) {
        draft = changeExecution(draft, base, {kind:'date',field:'startedAt',value}, now)
        assert.equal(resolveExecution(draft, base, now).valid, false)
      }
      assert.deepEqual(localTimes('2026-03-29T01:30'), [])
    })
  })

  it('handles half-hour repeated times and gaps without assuming a one-hour shift', () => {
    inTimezone('Australia/Lord_Howe', () => {
      const item = {...base,progress:100,startedAt:'2025-04-05T14:35:00Z',completedAt:'2025-04-05T15:15:00Z'}
      const draft = changeExecution(createExecutionDraft(item), item, {kind:'date',field:'completedAt',value:'2025-04-06T01:50'}, now)
      assert.equal(draft.completedAt.offset, '-630')
      assert.equal(localTimes(draft.completedAt.value).length, 2)
      assert.equal(executionPreview(item,draft,now).completedAt,'2025-04-05T15:20:00.000Z')
      assert.equal(resolveExecution(draft,item,now).actions.completedAt,'2025-04-05T15:20:00.000Z')
      assert.equal(localTimes('2025-10-05T02:15').length,0)
    })
  })

  it.each([
    ['America/New_York', '2025-11-02T01:30', 2], ['Asia/Kathmandu', '2025-11-02T01:30', 1], ['UTC', '2025-11-02T01:30', 1],
  ])('resolves %s without guessing a global timezone', (timezone, value, count) => {
    inTimezone(timezone, () => { assert.equal(localTimes(value).length, count); assert.equal(offsetLabel(-345), 'UTC+05:45') })
  })

  it('undo Done leaves a blank manual percentage and preserves the recorded start', () => {
    inTimezone('UTC', () => {
      const item = {...base,progress:100,startedAt:'2026-10-12T10:00:00Z',completedAt:'2026-10-14T10:00:00Z'}
      let draft = changeExecution(createExecutionDraft(item),item,{kind:'done'},now)
      assert.equal(draft.progress,'')
      assert.equal(draft.sliderProgress,100)
      assert.equal(resolveExecution(draft,item,now).valid,false)
      draft = changeExecution(draft,item,{kind:'progress',value:'65'},now)
      assert.equal(executionPreview(item,draft,now).startedAt,item.startedAt)
      assert.equal(executionPreview(item,draft,now).completedAt,undefined)
      assert.deepEqual(resolveExecution(draft,item,now).actions,{done:false})
      assert.equal(item.progress,100)
    })
  })

  it('undo Started explicitly resets dates and tracking without altering authored planning fields', () => {
    inTimezone('UTC', () => {
      const item = {...base,progress:100,startedAt:'2026-10-12T10:00:00Z',completedAt:'2026-10-14T10:00:00Z',blockerTrackingSince:'2026-10-12T10:00:00Z',blockerIntervals:[]}
      let draft = changeExecution(createExecutionDraft(item),item,{kind:'started'},now)
      assert.equal(draft.progress,'0')
      assert.deepEqual(resolveExecution(draft,item,now).actions,{started:false,done:false})
      const preview = executionPreview(item,draft,now)
      for (const field of ['startedAt','completedAt','blockerTrackingSince','blockerIntervals']) assert.equal(preview[field],undefined)
      assert.equal(preview.start,item.start)
      assert.equal(preview.durationDays,item.durationDays)
      draft = changeExecution(draft,item,{kind:'progress',value:'20'},now)
      assert.match(resolveExecution(draft,item,now).errors.progress ?? '',/Select Started/)
    })
  })

  it('does not invent historical dates from progress and rejects invalid manual percentages', () => {
    inTimezone('UTC', () => {
      const item = {...base,progress:100}
      assert.deepEqual(resolveExecution(createExecutionDraft(item),item,now).actions,{})
      assert.equal(executionPreview(item,createExecutionDraft(item),now).completedAt,undefined)
      for (const value of ['','-1','101','1.5']) {
        const draft = changeExecution(createExecutionDraft(base),base,{kind:'progress',value},now)
        assert.equal(draft.progress,value)
        assert.equal(resolveExecution(draft,base,now).valid,false)
      }
      const draft = changeExecution(createExecutionDraft(base),base,{kind:'progress',value:'100'},now)
      assert.deepEqual(resolveExecution(draft,base,now).actions,{done:true})
    })
  })
})
