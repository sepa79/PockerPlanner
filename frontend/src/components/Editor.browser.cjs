async (page, { origin = 'http://127.0.0.1:5198', screenshotDirectory = '/tmp' } = {}) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Use an isolated local preview')
  const context = await page.context().browser().newContext({ viewport: { width: 1171, height: 1000 }, timezoneId: 'Europe/London' })
  const tab = await context.newPage()
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const errors = []
  const unexpected = []
  const writes = []
  const linkedReads = []
  let viewer = false
  let linkedUnauthorized = false
  let failure = ''
  let gate = null
  const first = { id: 'a', name: 'First activity', streamId: 's', typeId: 't', start: '2026-10-12', durationDays: 3, progress: 100, status: 'Manual progress', issueIds: ['stale'], jiraUrl: '', startedAt: '2025-10-26T00:45:00.123Z', completedAt: '2025-10-26T01:15:00.456Z' }
  const issue = { id: 'all', title: 'All issue', description: 'Issue details', scope: 'ALL', streamIds: [], blocker: false, discovered: '2026-10-12', open: true, descriptionIncomplete: true, jiraUrl: '' }
  const plan = { id: 'p', name: 'Synthetic editor checks', description: 'Synthetic approach', deadline: '2026-11-01',
    streams: [{ id: 's', name: 'First stream', description: '' }, { id: 'second', name: 'Second stream', description: '' }],
    activityTypes: [{ id: 't', name: 'Test', color: '#ffc107' }],
    activities: [first, { ...first, id: 'after', name: 'Successor', progress: 0, startedAt: null, completedAt: null, dependsOn: 'a', issueIds: [] }],
    issues: [issue, { ...issue, id: 'stale', title: 'Stale link', scope: 'ACTIVITIES', activityIds: [], descriptionIncomplete: false }],
  }
  let state = { schemaVersion: 1, revision: 7, plans: [plan] }
  tab.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(() => sessionStorage.setItem('POCKETPLANNER_AUTH_SESSION', JSON.stringify({ accessToken: 'synthetic-editor-token', expiresAt: Date.now() + 3600000 })))
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) { unexpected.push(request.url()); await route.abort(); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/api/info') { await json({ name: 'PocketPlanner', version: 'synthetic-editor-test' }); return }
    if (url.pathname === '/api/session') { await json({ configured: true, canEdit: !viewer, user: { username: viewer ? 'synthetic-viewer' : 'synthetic-editor', displayName: 'Synthetic editor checks' } }); return }
    if (url.pathname === '/api/events') { await route.fulfill({ contentType: 'text/event-stream', body: ': isolated fixture\n\n' }); return }
    if (url.pathname === '/api/state' && request.method() === 'GET') { await json(state); return }
    if (url.pathname === '/api/integration/runs') {
      linkedReads.push({ search: url.search, authorization: request.headers().authorization })
      await json(linkedUnauthorized ? { error: 'Sign in required' } : { revision: state.revision, limitReached: false, runs: [{ swarmId: 'synthetic-swarm', runId: 'exact-run', activityIds: ['a'], scenarioId: 'test', unresolvedActivityTags: [], journalUrl: 'https://ph.example.test/journal/exact-run' }] }, linkedUnauthorized ? 401 : 200)
      return
    }
    if (['/api/state', '/api/activities'].includes(url.pathname) && request.method() === 'PUT') {
      const payload = request.postDataJSON()
      writes.push({ endpoint: url.pathname, payload })
      if (gate) await gate
      if (failure) { await json({ error: failure }, 400); return }
      if (url.pathname === '/api/state') state = { ...payload, revision: state.revision + 1 }
      else {
        const item = payload.item
        const current = state.plans[0].activities.find(activity => activity.id === item.id)
        const next = { ...current, ...item }
        for (const field of ['started', 'done']) delete next[field]
        if (item.started === false) for (const field of ['startedAt', 'completedAt', 'blockerTrackingSince', 'blockerIntervals']) delete next[field]
        if (item.done === false || item.progress < 100) delete next.completedAt
        if (item.done === true && !item.completedAt) next.completedAt = new Date().toISOString()
        state = { ...state, revision: state.revision + 1, plans: [{ ...state.plans[0], activities: state.plans[0].activities.map(activity => activity.id === item.id ? next : activity) }] }
      }
      await json(state)
      return
    }
    unexpected.push(request.method() + ' ' + request.url())
    await json({ error: 'Unexpected request in isolated editor fixture' }, 500)
  })
  const open = async () => { await tab.locator('.pp-activity-name').filter({ hasText: 'First activity' }).click(); await tab.locator('#editor').waitFor() }
  const cancel = async () => { await tab.getByRole('button', { name: 'Cancel', exact: true }).click(); await tab.locator('#editor').waitFor({ state: 'hidden' }) }
  const save = () => tab.locator('#editor').getByRole('button', { name: 'Save', exact: true }).click()
  try {
    await tab.goto(origin + '/#/plan')
    await tab.getByRole('button', { name: 'synthetic-editor · Sign out', exact: true }).waitFor()
    await open()
    ensure(linkedReads.length === 0, 'Linked runs were eagerly requested')
    ensure(await tab.getByRole('checkbox', { name: 'All issue' }).isChecked(), 'Scope membership not shown')
    ensure(!await tab.getByRole('checkbox', { name: 'Stale link' }).isChecked(), 'Stale links shown as assignments')
    const start = tab.getByLabel('Actual start', { exact: true })
    const finish = tab.getByLabel('Actual finish', { exact: true })
    ensure(await start.inputValue() > await finish.inputValue(), 'Repeated-hour fixture is not testing descending clock labels')
    ensure(await finish.evaluate(input => input.checkValidity()), 'Repeated-hour chronology used clock labels')
    ensure(await tab.getByLabel('Actual finish · time occurrence').inputValue() === '0', 'Recorded occurrence was not retained')
    await finish.fill('2025-10-26T01:20')
    ensure(await tab.getByLabel('Actual finish · time occurrence').inputValue() === '0', 'Same-day correction forgot recorded occurrence')
    await tab.screenshot({ path: screenshotDirectory + '/pp-react-editor-desktop.png' })
    await tab.setViewportSize({ width: 390, height: 844 })
    const layout = await tab.locator('#editor').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth, page: document.documentElement.scrollWidth > innerWidth }))
    ensure(layout.content <= layout.width && !layout.page, 'Mobile activity editor overflows: ' + JSON.stringify(layout))
    const progressPositions = await tab.locator('.pp-progress-controls').evaluate(element => [...element.children].map(child => child.getBoundingClientRect().top))
    ensure(Math.max(...progressPositions) - Math.min(...progressPositions) < 16, 'Started/slider/percentage/Done are not in one row')
    await tab.screenshot({ path: screenshotDirectory + '/pp-react-editor-mobile.png' })
    await save()
    await tab.locator('#editor').waitFor({ state: 'hidden' })
    ensure(writes.at(-1).payload.item.completedAt === '2025-10-26T01:20:00.000Z', 'Wrong repeated-hour correction submitted')
    ensure(!Object.hasOwn(writes.at(-1).payload.item, 'startedAt') && !Object.hasOwn(writes.at(-1).payload.item, 'blockerIntervals'), 'Unchanged server facts leaked into save')
    await open()
    await tab.getByRole('button', { name: 'Done', exact: true }).click()
    ensure(await tab.getByRole('spinbutton', { name: 'Progress · %' }).inputValue() === '', 'Undo Done guessed a percentage')
    const count = writes.length
    await save()
    ensure(writes.length === count, 'Blank undo percentage was saved')
    await tab.getByRole('spinbutton', { name: 'Progress · %' }).fill('65')
    await save()
    await tab.locator('#editor').waitFor({ state: 'hidden' })
    ensure(writes.at(-1).payload.item.done === false && writes.at(-1).payload.item.progress === 65, 'Undo Done omitted manual intent')
    await open()
    let release
    gate = new Promise(resolve => { release = resolve })
    failure = '<img src=x onerror=alert(1)>'
    await save()
    await tab.getByRole('button', { name: 'Saving…' }).waitFor()
    ensure(await tab.locator('#editor input, #editor select, #editor textarea, #editor button').evaluateAll(elements => elements.every(element => element.matches(':disabled'))), 'Save did not lock every field and action')
    await tab.keyboard.press('Escape')
    await tab.mouse.click(3, 3)
    ensure(await tab.locator('#editor').evaluate(element => element.open), 'Pending save allowed dismissal')
    release()
    gate = null
    await tab.locator('#editor [role=alert]').waitFor()
    ensure(await tab.locator('#editor img').count() === 0, 'Error string became HTML')
    failure = ''
    await cancel()
    await tab.setViewportSize({ width: 1171, height: 1000 })
    await open()
    const statusBox = await tab.getByRole('textbox', { name: 'Status / description' }).boundingBox()
    await tab.mouse.move(statusBox.x + 10, statusBox.y + 10)
    await tab.mouse.down()
    await tab.mouse.move(3, 3)
    await tab.mouse.up()
    ensure(await tab.locator('#editor').evaluate(element => element.open), 'Interior selection drag dismissed the editor')
    await tab.mouse.click(3, 3)
    await tab.locator('#editor').waitFor({ state: 'hidden' })
    await tab.getByRole('tab', { name: /^Issues/ }).click()
    await tab.getByRole('button', { name: 'All issue', exact: true }).click()
    const issueTitle = tab.getByRole('textbox', { name: 'Issue title' })
    const beforeEnter = writes.length
    await issueTitle.press('Enter')
    await tab.locator('#editor').waitFor({ state: 'hidden' })
    ensure(writes.length === beforeEnter + 1 && writes.at(-1).payload.plans[0].issues[0].open, 'Enter closed the issue instead of saving')
    await tab.getByRole('button', { name: 'All issue', exact: true }).click()
    await tab.setViewportSize({ width: 390, height: 844 })
    await tab.getByRole('combobox', { name: 'Affects' }).selectOption('ACTIVITIES')
    await tab.getByRole('checkbox', { name: 'First stream / First activity', exact: true }).check()
    ensure(await tab.locator('#editor').evaluate(element => element.scrollWidth <= element.clientWidth), 'Mobile issue editor overflows')
    await tab.screenshot({ path: screenshotDirectory + '/pp-react-issue-mobile.png' })
    await cancel()
    viewer = true
    linkedUnauthorized = true
    await tab.goto(origin + '/#/plan')
    await tab.reload()
    await tab.getByRole('button', { name: 'synthetic-viewer · Sign out', exact: true }).waitFor()
    await open()
    ensure(await tab.locator('#editor input, #editor select, #editor textarea').evaluateAll(elements => elements.every(element => element.matches(':disabled'))), 'Viewer can edit fields')
    ensure(await tab.locator('#editor').getByRole('button', { name: 'Save', exact: true }).count() === 0, 'Viewer has Save')
    await tab.getByText('PocketHive runs', { exact: true }).click()
    await tab.getByText('Sign in with PocketHive to see linked runs.', { exact: true }).waitFor()
    ensure(linkedReads.length === 1 && linkedReads[0].authorization === 'Bearer synthetic-editor-token', 'Linked runs bypassed authenticated API')
    ensure(errors.length === 0, 'Browser errors: ' + errors.join('; '))
    ensure(unexpected.length === 0, 'Unexpected requests: ' + unexpected.join('; '))
    return { checks: 'Native modal, repeated-hour correction, unchanged facts, manual undo Done, scoped saves, busy lock, Escape/backdrop/selection drag, safe errors, Enter issue Save, explicit issue targets, viewer, authenticated lazy runs/401, desktop/mobile', writes: writes.length, screenshots: ['pp-react-editor-desktop.png', 'pp-react-editor-mobile.png', 'pp-react-issue-mobile.png'] }
  } finally { await context.close() }
}
