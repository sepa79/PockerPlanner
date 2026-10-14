async (page) => {
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(async () => (await fetch("/api/state")).json());
  ensure((await state()).plans.length === 0, "Run only against an isolated server with an empty test database");
  const errors = [];
  const writes = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "PUT") writes.push(request.url()); });
  await page.setViewportSize({width: 1171, height: 1252});
  const auth = page.locator("#auth-dialog");
  await page.locator("#auth-button").click();
  await page.locator("#auth-username").click();
  ensure(await auth.evaluate(element => element.open), "Clicking inside login dismissed it");
  await page.mouse.click(6, 6);
  await auth.waitFor({state: "hidden"});
  ensure(writes.length === 0, "Dismissing login wrote plan data");
  await page.locator("#auth-button").click();
  await page.locator("#auth-username").fill("local-admin");
  await page.locator("#auth-form").getByRole("button", {name: "Sign in", exact: true}).click();
  await auth.waitFor({state: "hidden"});
  await page.evaluate(async () => {
    const fixture = await (await fetch("/example-plan.json")).json();
    fixture.plans[0].issues[0].blocker = true;
    const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(fixture)});
    if (!response.ok) throw new Error(await response.text());
  });
  await page.reload();
  const blocked = page.locator("#blocked-alert");
  await page.getByRole("button", {name: "Acknowledged", exact: true}).waitFor({state: "visible"});
  await page.mouse.click(6, 6);
  await page.keyboard.press("Escape");
  ensure(await blocked.evaluate(element => element.open), "The mandatory warning was dismissed without acknowledgement");
  await page.getByRole("button", {name: "Acknowledged", exact: true}).click();
  const editor = page.locator("#editor");
  const before = await state();
  const beforeWrites = writes.length;
  const cases = [
    {tab: "Plan", selector: ".activity-name", field: "[name=status]"},
    {tab: /^Issues/, selector: ".issue-title", field: "[name=description]"},
    {tab: "Streams", selector: ".stream-row", field: "[name=description]"},
    {tab: "Types", selector: ".type-row", field: "[name=name]"},
    {tab: "Plans", selector: '[data-edit="plan"]', field: "[name=description]"},
  ];
  for (const testCase of cases) {
    await page.getByRole("tab", {name: testCase.tab, exact: true}).click();
    await page.locator(testCase.selector).first().click();
    await editor.locator(testCase.field).fill("Unsaved draft for backdrop cancellation");
    await page.locator("#editor-title").click();
    ensure(await editor.evaluate(element => element.open), "An interior click dismissed the editor");
    const box = await editor.boundingBox();
    await page.mouse.click(box.x + 1, box.y + box.height / 2);
    ensure(await editor.evaluate(element => element.open), "Clicking the dialog border dismissed it");
    await page.mouse.click(6, 6);
    await editor.waitFor({state: "hidden"});
    ensure(JSON.stringify(await state()) === JSON.stringify(before), "Backdrop dismissal saved an unsaved draft");
  }
  await page.getByRole("tab", {name: "Plan", exact: true}).click();
  const underlying = await page.locator(".activity-name").first().boundingBox();
  await page.locator(".activity-name").first().click();
  const description = await editor.locator("[name=status]").boundingBox();
  await page.mouse.move(description.x + 10, description.y + 10);
  await page.mouse.down();
  await page.mouse.move(6, 6, {steps: 8});
  await page.mouse.up();
  ensure(await editor.evaluate(element => element.open), "Dragging from inside to outside dismissed the draft");
  await page.mouse.click(underlying.x + 2, underlying.y + underlying.height / 2);
  await editor.waitFor({state: "hidden"});
  ensure(!await editor.evaluate(element => element.open), "Backdrop click activated the underlying editor button");
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole("tab", {name: /^Issues/, exact: true}).click();
  await page.locator(".issue-title").first().click();
  await page.mouse.click(6, 6);
  await editor.waitFor({state: "hidden"});
  await page.locator("#auth-button").click();
  await page.locator(".issue-title").first().click();
  ensure(await editor.locator("[name=title]").isDisabled(), "The viewer unexpectedly has editing access");
  await page.mouse.click(6, 6);
  await editor.waitFor({state: "hidden"});
  await page.locator("#auth-button").click();
  await page.mouse.click(6, 6);
  await auth.waitFor({state: "hidden"});
  ensure(writes.length === beforeWrites && JSON.stringify(await state()) === JSON.stringify(before), "Dismissing dialogs changed saved data");
  ensure(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
  return {checks: "editor/login backdrop dismissal, all editor kinds, interior/border clicks, drag selection, unsaved draft cancellation, no click-through, mobile, view-only, mandatory warning, no writes", revision: before.revision};
}
