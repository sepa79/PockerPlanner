const assert = require('node:assert/strict');
const fs = require('node:fs');

async function verifyHistoricalImport(page) {
  const state = () => page.evaluate(async () => (await fetch('/api/state')).json());
  async function importFile(source) {
    await page.getByLabel('Workspace file').setInputFiles({name: 'synthetic-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source))});
    page.once('dialog', dialog => dialog.accept());
    const response = page.waitForResponse(value => value.url().endsWith('/api/state/import') && value.request().method() === 'PUT');
    await page.getByRole('button', {name: 'Import JSON', exact: true}).click();
    return response;
  }
  async function replace(source) {
    const before = await state();
    assert.equal((await importFile(source)).status(), 200);
    await page.getByText('Workspace imported and saved.', {exact: true}).waitFor();
    const expected = {...source, revision: before.revision + 1};
    assert.deepEqual(await state(), expected);
    return expected;
  }

  const historical = structuredClone(await state());
  historical.revision = 0;
  const activity = historical.plans[0].activities[0];
  Object.assign(activity, {
    progress: 100, startedAt: '2026-01-06T09:00:00Z', completedAt: '2026-01-07T09:00:00Z',
    blockerTrackingSince: '2026-01-06T09:00:00Z',
    blockerIntervals: [{issueId: 'synthetic-historical-issue', title: 'Synthetic recorded interruption', startedAt: '2026-01-06T10:00:00Z', endedAt: '2026-01-06T11:00:00Z'}],
  });
  Object.assign(historical.plans[0].issues[0], {open: false, resolvedAt: '2026-01-06T11:00:00Z'});
  await replace(historical);

  const downloaded = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const exported = JSON.parse(fs.readFileSync(await (await downloaded).path(), 'utf8'));
  assert.deepEqual(exported, historical);
  const corrected = structuredClone(exported);
  Object.assign(corrected.plans[0].activities[0], {startedAt: '2026-01-05T09:00:00Z', completedAt: '2026-01-08T09:00:00Z'});
  corrected.plans[0].issues[0].resolvedAt = '2026-01-07T11:00:00Z';
  await replace(corrected);
  const restored = await replace(exported);

  const invalid = structuredClone(exported);
  invalid.plans[0].activities[0].completedAt = '2026-01-05T09:00:00Z';
  assert.equal((await importFile(invalid)).status(), 400);
  await page.getByRole('status').filter({hasText: /Import failed:/}).waitFor();
  assert.deepEqual(await state(), restored);
  console.log('PASS explicit JSON import/export restores existing Started/Done, issue resolution and blocker history; invalid chronology leaves state unchanged');
}

module.exports = {verifyHistoricalImport};
