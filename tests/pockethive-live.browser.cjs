const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {deviceSignIn, confirmDeviceSignIn} = require('./support/device-signin.cjs');
const {journalHandoff} = require('./support/journal-handoff.cjs');

const {chromium} = require(process.env.POCKETPLANNER_TEST_PLAYWRIGHT);
const plannerOrigin = process.env.POCKETPLANNER_LIVE_QA_ORIGIN;
const hiveOrigin = process.env.POCKETPLANNER_LIVE_PH_ORIGIN;
for (const origin of [plannerOrigin, hiveOrigin]) assert.match(origin || '', /^http:\/\/localhost:\d+$/);
const artifacts = process.env.POCKETPLANNER_TEST_ARTIFACTS;
assert.ok(artifacts && path.isAbsolute(artifacts));
fs.mkdirSync(artifacts, {recursive: true});
const swarmId = 'pp-java-qa-' + Date.now();
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts/workspace.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
fixture.plans[0].name = 'Java / PH integration QA';
fixture.plans[0].description = 'Synthetic UI acceptance only. Real PH lifecycle against local WireMock; no operational plans or payment system.';
fixture.plans[0].deadline = null;
fixture.plans[0].issues = [];
for (const item of fixture.plans[0].activities) { item.start = today; item.issueIds = []; }

async function phApi(page, method, endpoint, body) {
  return page.evaluate(async ({method, endpoint, body}) => {
    const response = await fetch('/orchestrator' + endpoint, {method, headers: {Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    const result = await response.json();
    return {status: response.status, body: result};
  }, {method, endpoint, body});
}

async function settle(page, accepted) {
  assert.ok(accepted.correlationId && accepted.idempotencyKey);
  const deadline = Date.now() + Math.min((accepted.timeoutMs || 120000) + 15000, 195000);
  while (Date.now() < deadline) {
    const result = await phApi(page, 'GET', '/api/swarms/' + swarmId + '/operations/' + accepted.correlationId);
    assert.equal(result.status, 200);
    assert.equal(result.body.swarmId, swarmId);
    assert.equal(result.body.correlationId, accepted.correlationId);
    if (!['ACCEPTED', 'DISPATCHED'].includes(result.body.state)) {
      assert.equal(result.body.state, 'SUCCEEDED', result.body.type + ' ended in ' + result.body.state);
      return result.body;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Exact PH operation did not finish before its deadline');
}

(async () => {
  let browser;
  let planner;
  let ph;
  let cleanup = false;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.POCKETPLANNER_TEST_BROWSER});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Europe/London'});
    context.setDefaultTimeout(20000);
    planner = await context.newPage();
    const errors = [];
    planner.on('pageerror', error => errors.push(error.message));
    await planner.goto(plannerOrigin + '/#/data');
    const before = await planner.evaluate(async () => (await fetch('/api/state')).json());
    await deviceSignIn(planner, context, false);
    if (before.plans.length) {
      assert.equal(before.plans.length, 1, 'Use only the isolated QA Planner');
      assert.equal(before.plans[0].name, fixture.plans[0].name);
      assert.equal(before.plans[0].description, fixture.plans[0].description);
      assert.deepEqual(before.plans[0].activities.map(item => item.id), fixture.plans[0].activities.map(item => item.id));
    }
    await planner.getByLabel('Workspace file').setInputFiles({name: 'synthetic-live-qa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture))});
    planner.once('dialog', dialog => dialog.accept());
    await planner.getByRole('button', {name: 'Import JSON', exact: true}).click();
    await planner.getByText('Workspace imported and saved.', {exact: true}).waitFor();
    await planner.getByRole('tab', {name: 'Plan', exact: true}).click();
    await planner.getByRole('button', {name: 'Synthetic Alpha minimal', exact: true}).click();
    await planner.locator('#activity-started').click();
    await planner.locator('#field-progress').fill('25');
    await planner.getByRole('button', {name: 'Save', exact: true}).click();
    await planner.locator('#editor').waitFor({state: 'detached'});
    const saved = await planner.evaluate(async () => (await fetch('/api/state')).json());
    console.log('PASS real PP device login and synthetic plan import/manual facts');

    ph = await context.newPage();
    ph.on('pageerror', error => errors.push(error.message));
    await ph.goto(hiveOrigin + '/login');
    const confirmationOpened = context.waitForEvent('page');
    await ph.getByRole('button', {name: 'Sign in with PocketHive', exact: true}).click();
    const confirmation = await confirmationOpened;
    try {
      await confirmDeviceSignIn(confirmation, true);
      await ph.getByRole('button', {name: 'Sign out', exact: true}).waitFor({timeout: 45000});
    } finally { await confirmation.close(); }
    assert.equal(await ph.locator('#username').count(), 0);
    const catalogue = await phApi(ph, 'GET', '/api/planner/catalogue');
    assert.equal(catalogue.status, 200);
    assert.equal(catalogue.body.instanceId, 'integration-qa');
    assert.equal(catalogue.body.plans[0].name, fixture.plans[0].name);
    console.log('PASS central PH sign-in reuse and live Planner catalogue');
    await ph.goto(hiveOrigin + '/hive');
    await ph.getByRole('button', {name: 'New swarm', exact: true}).click();
    await ph.getByLabel('Swarm ID', {exact: true}).fill(swarmId);
    await ph.getByLabel('Scenario filter', {exact: true}).fill('Artemis REST lifecycle smoke');
    await ph.getByText('Artemis REST lifecycle smoke', {exact: true}).click();
    await ph.getByLabel('Bundle SUT', {exact: false}).selectOption('wiremock-local');
    await ph.getByRole('checkbox', {name: 'Link to PocketPlanner', exact: true}).check();
    await ph.getByLabel('Plan', {exact: true}).selectOption('contract-plan');
    await ph.getByLabel('Stream', {exact: true}).selectOption('stream-alpha');
    await ph.getByLabel('Activity', {exact: true}).selectOption('activity-alpha-minimal');
    await ph.getByRole('checkbox', {name: 'Pull images', exact: true}).uncheck();
    const creationResponse = ph.waitForResponse(response => response.url().endsWith('/orchestrator/api/swarms/' + swarmId + '/create') && response.request().method() === 'POST');
    cleanup = true;
    await ph.getByRole('button', {name: 'Create swarm', exact: true}).click();
    const creation = await creationResponse;
    assert.equal(creation.status(), 202);
    console.log('Accepted real CREATE for ' + swarmId + '; waiting for PH confirmation');
    const operation = await settle(ph, await creation.json());
    const runId = operation.runtime.runId;
    assert.ok(runId);
    await ph.getByRole('dialog').waitFor({state: 'hidden', timeout: 130000});
    let reference = await phApi(ph, 'GET', '/api/planner/runs/' + swarmId + '/' + runId);
    assert.equal(reference.status, 200);
    assert.equal(reference.body.testPlan, 'pp:integration-qa:contract-plan');
    assert.ok(reference.body.tags.includes(catalogue.body.plans[0].activities[0].tag));
    console.log('PASS PH catalogue, Plan/Stream/Activity picker, real CREATE and persisted testPlan/tag');

    await ph.goto(hiveOrigin + '/hive/' + swarmId);
    const associations = ph.getByRole('region', {name: 'PocketPlanner run associations', exact: true});
    await associations.getByLabel('Plan', {exact: true}).selectOption('contract-plan');
    await associations.getByLabel('Stream', {exact: true}).selectOption('stream-alpha');
    await associations.getByLabel('Activity', {exact: true}).selectOption('activity-alpha-heavy');
    await associations.getByRole('button', {name: 'Link Activity', exact: true}).click();
    await associations.getByText('Synthetic Alpha / Synthetic Alpha heavy', {exact: true}).waitFor();
    reference = await phApi(ph, 'GET', '/api/planner/runs/' + swarmId + '/' + runId);
    assert.ok(reference.body.tags.includes(catalogue.body.plans[0].activities[1].tag));

    await planner.getByRole('button', {name: 'Execution', exact: true}).click();
    const run = planner.locator('.pp-runtime-run').filter({hasText: swarmId}).first();
    await run.waitFor({timeout: 45000}); await run.click();
    await planner.getByText(runId, {exact: true}).waitFor();
    const handoff = await journalHandoff(planner, context, hiveOrigin, swarmId, runId);
    assert.equal(handoff.journalReadStatus, 200);
    assert.equal(handoff.journalDataVerified, true);
    console.log(JSON.stringify(handoff));
    await planner.getByRole('button', {name: 'Start', exact: true}).click();
    await planner.getByText('Start succeeded · confirmed by PH.', {exact: true}).waitFor({timeout: 190000});
    await planner.locator('.pp-swarm-panel').getByText('Running', {exact: true}).waitFor({timeout: 45000});
    await planner.screenshot({path: path.join(artifacts, 'pp-real-ph-running.png')});
    planner.once('dialog', dialog => dialog.accept());
    await planner.getByRole('button', {name: 'Stop', exact: true}).click();
    await planner.getByText('Stop succeeded · confirmed by PH.', {exact: true}).waitFor({timeout: 190000});
    const current = await planner.evaluate(async () => (await fetch('/api/state')).json());
    assert.deepEqual(current, saved, 'PH associations/control must not change any Planner facts');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({swarmId, runId, realCreate: true, planStreamActivityPicker: true, multipleActivities: true,
      realJournalData: true, centralSessionReuse: true, realStartStop: true, plannerFactsUnchanged: true,
      paymentSystemTraffic: false, redisMutations: false, pageErrors: errors.length}, null, 2));
  } catch (failure) {
    if (planner) await planner.screenshot({path: path.join(artifacts, 'pp-real-ph-failure.png')}).catch(() => {});
    if (ph) await ph.screenshot({path: path.join(artifacts, 'ph-real-failure.png')}).catch(() => {});
    console.error(failure.message);
    process.exitCode = 1;
  } finally {
    if (cleanup && ph) {
      try {
        const removed = await phApi(ph, 'POST', '/api/swarms/' + swarmId + '/remove', {idempotencyKey: randomUUID()});
        if (removed.status === 202) await settle(ph, removed.body);
        else if (removed.status !== 404) throw new Error('Owned QA swarm REMOVE returned ' + removed.status);
        console.log('PASS cleanup of the exact owned QA swarm only');
      } catch (failure) { console.error('Owned QA cleanup incomplete: ' + failure.message); process.exitCode = 1; }
    }
    if (browser) await browser.close();
  }
})();
