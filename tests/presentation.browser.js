async (page) => {
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(async () => (await fetch("/api/state")).json());
  ensure((await state()).plans.length === 0, "Run only against an isolated server with an empty test database");
  const errors = [];
  const writes = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "PUT") writes.push(request.url()); });
  await page.setViewportSize({width: 1171, height: 1252});
  await page.locator("#app-version").waitFor({state: "visible"});
  const information = await page.evaluate(async () => (await fetch("/api/info")).json());
  ensure(await page.locator("#app-version").textContent() === `v${information.version}`, "The displayed version differs from server metadata");
  ensure(await page.locator(".brand img").getAttribute("src") === "/pocketplanner-topbar.svg", "The header still uses the large logo");
  const logos = await page.evaluate(async () => ({header: await (await fetch("/pocketplanner-topbar.svg")).text(), large: await (await fetch("/pocketplanner-logo.svg")).text()}));
  ensure(!logos.header.includes("simple test plan") && logos.large.includes("simple test plan"), "The subtitle is missing from the large logo or still appears in the header");
  const captureExports = () => page.evaluate(() => {
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = blob => { window.qaExportBlob = blob; return createObjectURL.call(URL, blob); };
  });
  await captureExports();
  const downloadNamed = async name => {
    const pending = page.waitForEvent("download");
    await page.locator("#export-json").click();
    const download = await pending;
    ensure(download.suggestedFilename() === name, `Expected ${name}, received ${download.suggestedFilename()}`);
    await download.delete();
  };
  await page.getByRole("tab", {name: "Data", exact: true}).click();
  await downloadNamed("pocketplanner-plan.json");
  await page.evaluate(() => window.PocketAuth.login("local-admin"));
  await page.evaluate(async () => {
    const fixture = {schemaVersion: 1, revision: 0, plans: [
      {id: "first", name: "Plan A / QA: ścieżka?", description: "", streams: [], activityTypes: [], activities: [], issues: []},
      {id: "second", name: "Second plan", description: "", streams: [], activityTypes: [], activities: [], issues: []},
      {id: "reserved", name: "CON", description: "", streams: [], activityTypes: [], activities: [], issues: []},
    ]};
    const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(fixture)});
    if (!response.ok) throw new Error(await response.text());
  });
  await page.reload();
  await captureExports();
  const selection = page.getByRole("combobox", {name: "Active plan", exact: true});
  await selection.selectOption("first");
  await page.getByRole("tab", {name: "Data", exact: true}).click();
  const before = await state();
  const beforeWrites = writes.length;
  await downloadNamed("Plan A - QA- ścieżka-.json");
  const exported = await page.evaluate(async () => JSON.parse(await window.qaExportBlob.text()));
  ensure(exported.revision === 0 && JSON.stringify(exported.plans) === JSON.stringify(before.plans), "A named export changed workspace content or scope");
  await selection.selectOption("second");
  await downloadNamed("Second plan.json");
  await selection.selectOption("reserved");
  await downloadNamed("_CON.json");
  ensure(writes.length === beforeWrites && JSON.stringify(await state()) === JSON.stringify(before), "Changing selection or exporting changed saved data");
  await page.setViewportSize({width: 390, height: 844});
  const mobile = await page.locator(".topbar").evaluate(element => ({width: element.clientWidth, content: element.scrollWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth}));
  ensure(mobile.content <= mobile.width && !mobile.pageOverflow, "Logo or version overflows on mobile");
  ensure(await page.locator("#app-version").isVisible(), "Version disappears on mobile");
  await page.screenshot({path: ".playwright-mcp/presentation-mobile.png", fullPage: true});
  await page.setViewportSize({width: 1171, height: 1252});
  await page.screenshot({path: ".playwright-mcp/presentation-desktop.png", fullPage: true});
  const unavailableInfo = route => route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Synthetic metadata outage"})});
  await page.route("**/api/info", unavailableInfo);
  await page.reload();
  await page.waitForFunction(() => document.getElementById("app-version").textContent === "Version unavailable" && document.getElementById("active-plan").options.length === 3);
  ensure(JSON.stringify(await state()) === JSON.stringify(before), "Version failure changed plan data");
  await page.unroute("**/api/info", unavailableInfo);
  await page.reload();
  await page.waitForFunction(version => document.getElementById("app-version").textContent === `v${version}`, information.version);
  ensure(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
  return {checks: "canonical version, explicit metadata failure/recovery, header/large logo variants, empty/named/selected exports, Unicode, filename safety, reserved names, unchanged all-plan content, no writes, mobile", version: information.version, mobile};
}
