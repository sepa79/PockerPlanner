import assert from 'node:assert/strict'
import { test } from 'vitest'
import { remainingDays, timing } from './schedule'

const estimate = { start: '2026-10-16', durationDays: 3, progress: 0 }

test('remaining effort rounds up scheduled days without changing the full estimate', () => {
  assert.equal(remainingDays(estimate), 3)
  assert.equal(remainingDays({ ...estimate, progress: 50 }), 2)
  assert.equal(remainingDays({ durationDays: 365, progress: 99 }), 4)
  assert.equal(remainingDays({ ...estimate, progress: 100 }), 0)
  assert.equal(estimate.durationDays, 3)
})

test('unstarted work retains authored dates and has no fabricated elapsed or blocking facts', () => {
  const result = timing(estimate, '2026-10-14T12:00:00Z')
  assert.equal(result.remainingDays, 3)
  assert.equal(result.forecast?.start, '2026-10-16')
  assert.equal(result.forecast?.end, '2026-10-20')
  assert.equal(result.elapsedDays, null)
  assert.equal(result.blockedDays, null)
})

test('started work projects approximate remaining effort from the reference day', () => {
  const item = { ...estimate, progress: 50, startedAt: '2026-10-12T12:00:00Z' }
  const result = timing(item, '2026-10-14T12:00:00Z')
  assert.equal(result.remainingDays, 2)
  assert.deepEqual(result.forecast?.days, ['2026-10-14', '2026-10-15'])
  assert.equal(result.elapsedDays, 2)
  assert.equal(result.blockedDays, null)
  assert.equal(item.start, '2026-10-16')
  assert.equal(item.durationDays, 3)
})

test('saved Started at zero percent projects the full estimate with individual weekend eligibility', () => {
  const item = { ...estimate, startedAt: '2026-10-12T12:00:00Z' }
  const weekdays = timing(item, '2026-10-17T12:00:00Z')
  assert.deepEqual(weekdays.forecast?.days, ['2026-10-19', '2026-10-20', '2026-10-21'])
  const weekends = timing({ ...item, includeWeekends: true }, '2026-10-17T12:00:00Z')
  assert.deepEqual(weekends.forecast?.days, ['2026-10-17', '2026-10-18', '2026-10-19'])
  assert.equal(weekdays.elapsedDays, 5)
})

test('recorded blocking unions overlapping history once and clips it to the actual completed period', () => {
  const item = {
    ...estimate, progress: 100, startedAt: '2026-10-12T12:00:00Z', completedAt: '2026-10-16T12:00:00Z',
    blockerTrackingSince: '2026-10-12T12:00:00Z',
    blockerIntervals: [
      { issueId: 'removed-issue', startedAt: '2026-10-10T12:00:00Z', endedAt: '2026-10-14T12:00:00Z' },
      { issueId: 'overlap', startedAt: '2026-10-13T12:00:00Z', endedAt: '2026-10-15T12:00:00Z' },
      { issueId: 'later', startedAt: '2026-10-15T12:00:00Z', endedAt: '2026-10-19T12:00:00Z' },
      { issueId: 'outside', startedAt: '2026-10-09T12:00:00Z', endedAt: '2026-10-10T12:00:00Z' },
    ],
  }
  const original = structuredClone(item)
  const result = timing(item, '2026-10-20T12:00:00Z')
  assert.equal(result.remainingDays, 0)
  assert.equal(result.forecast, null)
  assert.equal(result.elapsedDays, 4)
  assert.equal(result.blockedDays, 4)
  assert.deepEqual(item, original)
})

test('active recorded intervals end at now and tracked zero blocking differs from missing coverage', () => {
  const item = {
    ...estimate, startedAt: '2026-10-12T12:00:00Z', blockerTrackingSince: '2026-10-12T12:00:00Z',
    blockerIntervals: [
      { issueId: 'ended', startedAt: '2026-10-13T12:00:00Z', endedAt: '2026-10-14T12:00:00Z' },
      { issueId: 'active', startedAt: '2026-10-13T18:00:00Z', endedAt: null },
    ],
  }
  const result = timing(item, '2026-10-16T12:00:00Z')
  assert.equal(result.elapsedDays, 4)
  assert.equal(result.blockedDays, 3)
  assert.equal(timing({ ...item, blockerIntervals: [] }, '2026-10-16T12:00:00Z').blockedDays, 0)
  assert.equal(timing({ ...item, blockerTrackingSince: null }, '2026-10-16T12:00:00Z').blockedDays, null)
})

test('completed legacy percentages without actual dates remain explicitly unrecorded', () => {
  const result = timing({ ...estimate, progress: 100 }, '2026-10-20T12:00:00Z')
  assert.equal(result.remainingDays, 0)
  assert.equal(result.forecast, null)
  assert.equal(result.elapsedDays, null)
  assert.equal(result.blockedDays, null)
})

test('elapsed time measures actual instants across daylight-saving offsets', () => {
  const result = timing({
    ...estimate, progress: 100,
    startedAt: '2026-10-24T12:00:00+01:00', completedAt: '2026-10-25T12:00:00Z',
  })
  assert.equal(result.elapsedDays, 25 / 24)
})
