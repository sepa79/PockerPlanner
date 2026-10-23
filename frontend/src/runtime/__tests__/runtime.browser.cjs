async (page, { origin = 'http://127.0.0.1:5197', screenshotDirectory = '/tmp' } = {}) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Use an isolated local frontend preview')
  const context = await page.context().browser().newContext({ viewport: { width: 1360, height: 900 } })
  const tab = await context.newPage()
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const errors = []
  const unexpected = []
  const commands = []
  const operations = []
  const writes = []
  let outage = false
  let operationState = 'DISPATCHED'
  let workloadState = 'STOPPED'
  let action = 'START'
  const activity = (id, streamId, name, progress) => ({ id, streamId, name, progress, typeId: 'type', start: '2026-10-19', durationDays: 2, status: '', issueIds: [], jiraUrl: '' })
  const plan = { id: 'synthetic', name: 'Synthetic runtime browser checks', description: '', streams: [
    { id: 'one', name: 'One', description: '' }, { id: 'two', name: 'Two', description: '' },
  ], activityTypes: [{ id: 'type', name: 'Test', color: '#36dfff' }], issues: [], activities: [
    activity('minimal', 'one', 'Minimal', 25), activity('heavy', 'one', 'Heavy', 0), activity('background', 'two', 'Background', 100),
  ] }
  const state = { schemaVersion: 1, revision: 1, plans: [plan] }
  const runtime = (id, runId) => ({ id, runId, runtimeIntent: 'PRESENT', workloadIntent: workloadState, workloadState, controllerState: 'READY', health: 'HEALTHY',
    runtimeResourceState: 'PRESENT', observedAt: new Date().toISOString(), observationStale: false, activeOperation: null,
    workers: ['generator', 'processor', 'postprocessor'].map(role => ({ role, instance: role, tps: 10, enabled: true, stale: false, lastSeenAt: new Date().toISOString() })) })
  const run = () => ({ swarmId: 'shared-qa', runId: 'run-one', activityIds: ['minimal', 'heavy', 'background'], scenarioId: 'Synthetic scenario', unresolvedActivityTags: [],
    journalUrl: 'http://localhost:8089/journal/swarms/shared-qa?runId=run-one', canStart: true, canStop: true, runtime: runtime('shared-qa', 'run-one') })
  const snapshot = () => {
    const current = run()
    return { revision: 1, fetchedAt: new Date().toISOString(), limitReached: true, runs: [current,
      { ...current, swarmId: 'old-qa', runId: 'old-run', activityIds: ['minimal'], runtime: null },
      { ...current, swarmId: '<img src=x onerror="bad()">', runId: 'stale-run', activityIds: ['minimal'], runtime: { ...runtime('<img src=x onerror="bad()">', 'stale-run'), observationStale: true } },
      { ...current, swarmId: 'unresolved-qa', runId: 'unresolved-run', activityIds: [], unresolvedActivityTags: ['deleted'], runtime: runtime('unresolved-qa', 'unresolved-run') },
    ] }
  }
  tab.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(() => sessionStorage.setItem('POCKETPLANNER_AUTH_SESSION', JSON.stringify({ accessToken: 'synthetic-runtime-browser-token', expiresAt: Date.now() + 3600000 })))
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) { unexpected.push(request.url()); await route.abort(); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (['POST', 'PUT', 'DELETE'].includes(request.method()) && ['/api/state', '/api/activities'].includes(url.pathname)) writes.push(url.pathname)
    if (url.pathname === '/api/state' && request.method() === 'GET') { await json(state); return }
    if (url.pathname === '/api/info') { await json({ name: 'PocketPlanner', version: 'synthetic-browser-check' }); return }
    if (url.pathname === '/api/session') { await json({ configured: true, canEdit: true, user: { username: 'synthetic', displayName: 'Synthetic viewer' } }); return }
    if (url.pathname === '/api/events') { await route.fulfill({ contentType: 'text/event-stream', body: ': synthetic isolated event stream\n\n' }); return }
    if (url.pathname === '/api/integration/execution') {
      await json(outage ? { error: 'Synthetic PH outage' } : snapshot(), outage ? 503 : 200)
      return
    }
    if (url.pathname === '/api/integration/control') {
      const command = request.postDataJSON()
      commands.push(command)
      ensure(command.planId === plan.id && command.swarmId === 'shared-qa' && command.runId === 'run-one', 'Wrong exact command identity')
      action = command.action.toUpperCase()
      operationState = 'DISPATCHED'
      await json({ correlationId: 'synthetic-operation-' + commands.length, idempotencyKey: command.idempotencyKey, timeoutMs: 90000 })
      return
    }
    if (url.pathname === '/api/integration/operation') {
      operations.push(url.search)
      ensure(url.searchParams.get('planId') === plan.id && url.searchParams.get('swarmId') === 'shared-qa' && url.searchParams.get('runId') === 'run-one', 'Wrong exact operation identity')
      ensure(url.searchParams.get('correlationId') === 'synthetic-operation-' + commands.length, 'Wrong operation correlation')
      await json({ swarmId: 'shared-qa', runtime: { runId: 'run-one' }, correlationId: url.searchParams.get('correlationId'), type: action, state: operationState })
      return
    }
    unexpected.push(request.method() + ' ' + request.url())
    await json({ error: 'Unexpected request in isolated browser fixture' }, 500)
  })
  try {
    await tab.goto(origin + '/#/plan')
    await tab.getByRole('button', { name: 'synthetic · Sign out', exact: true }).waitFor()
    await tab.getByRole('button', { name: 'Execution', exact: true }).click()
    const minimal = tab.locator('[data-activity-id="minimal"]')
    await minimal.locator('.pp-runtime-run').first().waitFor()
    ensure(await minimal.locator('.pp-runtime-run').count() === 2, 'Multiple current associations missing')
    ensure(JSON.stringify(await minimal.locator('.pp-runtime-tps b').allTextContents()) === JSON.stringify(['10', '—']), 'TPS double-counting or stale metrics')
    ensure(await tab.locator('.pp-runtime img').count() === 0, 'Untrusted runtime name became markup')
    await tab.getByRole('checkbox', { name: 'Show run history' }).check()
    ensure(await minimal.locator('.pp-runtime-run').count() === 3, 'Explicit history is missing')
    await tab.getByRole('checkbox', { name: 'Show run history' }).uncheck()
    const fold = tab.getByRole('button', { name: /runs for Minimal$/ })
    await fold.click()
    await fold.focus()
    await tab.waitForTimeout(5300)
    ensure(await fold.getAttribute('aria-expanded') === 'false' && await fold.evaluate(element => element === document.activeElement), 'Polling lost fold state or keyboard focus')
    await fold.click()
    await tab.screenshot({ path: screenshotDirectory + '/pp-react-execution-desktop.png' })
    await tab.setViewportSize({ width: 390, height: 844 })
    ensure(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile execution overflows')
    await tab.screenshot({ path: screenshotDirectory + '/pp-react-execution-mobile.png' })
    await minimal.getByRole('button', { name: /^shared-qa ·/ }).click()
    await tab.getByRole('heading', { name: 'shared-qa', exact: true }).waitFor()
    ensure(await tab.getByRole('link', { name: /Open PH journal/ }).getAttribute('href') === run().journalUrl, 'Backend HTTP journal link was rewritten')
    ensure(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.pp-swarm-content').scrollWidth <= document.querySelector('.pp-swarm-content').clientWidth), 'Mobile swarm panel overflows')
    await tab.screenshot({ path: screenshotDirectory + '/pp-react-swarm-mobile.png' })
    await tab.getByRole('button', { name: 'Start', exact: true }).click()
    await tab.getByText(/Waiting for the authoritative outcome/).waitFor()
    await tab.getByRole('button', { name: 'Close swarm panel' }).click()
    await tab.getByRole('button', { name: 'Plan', exact: true }).click()
    const previousReads = operations.length
    operationState = 'SUCCEEDED'
    workloadState = 'RUNNING'
    await tab.waitForTimeout(1800)
    ensure(operations.length > previousReads, 'Closing the panel lost the pending command')
    await tab.getByRole('button', { name: 'Execution', exact: true }).click()
    await minimal.getByRole('button', { name: /^shared-qa ·/ }).click()
    await tab.getByText('Start succeeded · confirmed by PH.', { exact: true }).waitFor()
    ensure(commands.length === 1, 'A close/reopen repeated a lifecycle command')
    tab.once('dialog', dialog => dialog.dismiss())
    await tab.getByRole('button', { name: 'Stop', exact: true }).click()
    ensure(commands.length === 1, 'Cancelled Stop submitted a command')
    await tab.getByRole('button', { name: 'Close swarm panel' }).click()
    outage = true
    await tab.getByRole('button', { name: 'Refresh PH', exact: true }).click()
    await tab.getByText(/last observation shown; data is outdated/).waitFor()
    ensure(await minimal.locator('.pp-runtime-run').count() === 2, 'Outage erased the last snapshot')
    await minimal.getByRole('button', { name: /^shared-qa ·/ }).click()
    ensure(await tab.getByRole('button', { name: 'Start', exact: true }).isDisabled() && await tab.getByRole('button', { name: 'Stop', exact: true }).isDisabled(), 'Outage left controls enabled')
    await tab.getByRole('button', { name: 'Close swarm panel' }).click()
    outage = false
    await tab.getByRole('button', { name: 'Refresh PH', exact: true }).click()
    await tab.getByRole('button', { name: 'Mixed', exact: true }).click()
    await tab.locator('.pp-runtime-mixed').first().waitFor()
    ensure(await tab.locator('.pp-bar').count() === 3, 'Mixed added task frames or lost Activities')
    ensure(await tab.locator('.pp-runtime-mixed').count() === 3, 'Mixed omitted Activity associations')
    await tab.getByRole('button', { name: 'Collapse One', exact: true }).click()
    const summary = tab.locator('.pp-runtime-mixed[data-runtime-stream="one"]')
    ensure(await summary.getByRole('button', { name: /^shared-qa ·/ }).count() === 1, 'Collapsed Mixed summary duplicated a shared run')
    ensure(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile Mixed attachments overflow')
    await tab.screenshot({ path: screenshotDirectory + '/pp-react-mixed-mobile.png' })
    await tab.setViewportSize({ width: 1360, height: 900 })
    ensure(errors.length === 0, 'Browser errors: ' + JSON.stringify(errors))
    ensure(writes.length === 0 && unexpected.length === 0, 'Unexpected requests: ' + JSON.stringify({ writes, unexpected }))
    return { commands: commands.length, operationReads: operations.length, planningWrites: writes.length, browserErrors: errors, screenshots: [
      screenshotDirectory + '/pp-react-execution-desktop.png', screenshotDirectory + '/pp-react-execution-mobile.png', screenshotDirectory + '/pp-react-swarm-mobile.png', screenshotDirectory + '/pp-react-mixed-mobile.png',
    ] }
  } finally { await context.close() }
}
