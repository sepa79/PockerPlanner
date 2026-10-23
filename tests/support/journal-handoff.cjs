const assert = require('node:assert/strict');
const {confirmDeviceSignIn} = require('./device-signin.cjs');

async function journalHandoff(page, context, origin, swarmId, runId) {
  const link = page.getByRole('link', {name: 'Open PH journal ↗', exact: true});
  const expected = new URL(await link.getAttribute('href'));
  assert.equal(expected.origin, origin);
  assert.equal(expected.pathname, '/journal/swarms/' + encodeURIComponent(swarmId));
  assert.deepEqual([...expected.searchParams.keys()], ['runId']);
  assert.equal(expected.searchParams.get('runId'), runId);
  const opened = context.waitForEvent('page');
  const journalRead = context.waitForEvent('request', {predicate: request => {
    const url = new URL(request.url());
    return url.origin === origin && url.pathname === '/orchestrator/api/swarms/' + encodeURIComponent(swarmId) + '/journal/page'
      && url.searchParams.get('runId') === runId;
  }, timeout: 45000});
  await link.click();
  const journal = await opened;
  try {
    const signIn = journal.getByRole('button', {name: 'Sign in with PocketHive', exact: true});
    const confirmationRequired = await Promise.race([
      journalRead.then(() => false),
      signIn.waitFor({state: 'visible'}).then(() => true),
    ]);
    if (confirmationRequired) {
      const confirmationOpened = context.waitForEvent('page');
      await signIn.click();
      const confirmation = await confirmationOpened;
      try {
        await confirmDeviceSignIn(confirmation, true);
        await journalRead;
      } finally { await confirmation.close(); }
    }
    const request = await journalRead;
    assert.match((await request.allHeaders()).authorization || '', /^Bearer\s+\S+$/);
    await journal.waitForURL(expected.href);
    const response = await request.response();
    assert.ok(response);
    assert.equal(await journal.locator('#username').count(), 0);
    return {centralSessionHandoff: true, independentPhAuthorization: true, exactRunPreserved: true, confirmationRequired,
      journalReadStatus: response.status(), journalDataVerified: response.ok()};
  } finally { await journal.close(); }
}

module.exports = {journalHandoff};
