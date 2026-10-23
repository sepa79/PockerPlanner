const assert = require('node:assert/strict');

async function confirmDeviceSignIn(popup, reuse) {
  const confirm = popup.getByRole('button', {name: 'Confirm sign in', exact: true});
  const complete = popup.getByRole('heading', {name: 'Confirmation complete', exact: true});
  await popup.locator('#username').or(confirm).or(complete).waitFor();
  if (await popup.locator('#username').isVisible()) {
    assert.equal(reuse, false, 'PH central session was not reused');
    await popup.locator('#username').fill('local-admin');
    await popup.getByRole('button', {name: 'Sign in', exact: true}).click();
  }
  await confirm.or(complete).waitFor();
  if (await confirm.isVisible()) await confirm.click();
}

async function deviceSignIn(page, context, reuse) {
  const opened = context.waitForEvent('page');
  await page.getByRole('button', {name: 'View only · Sign in', exact: true}).click();
  const popup = await opened;
  try {
    await confirmDeviceSignIn(popup, reuse);
    await page.getByRole('button', {name: 'local-admin · Sign out', exact: true}).waitFor({timeout: 45000});
  } finally { await popup.close(); }
}

module.exports = {deviceSignIn, confirmDeviceSignIn};
