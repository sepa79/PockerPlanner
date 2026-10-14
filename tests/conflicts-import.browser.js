async (page) => {
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(async () => (await fetch("/api/state")).json());
  ensure((await state()).plans.length === 0, "Run only against an isolated server with an empty test database");
  const errors = [];
  const writes = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "PUT" && /\/api\/(?:state|activities)$/.test(request.url())) writes.push(request.url()); });
  await page.setViewportSize({width: 1171, height: 1252});
  await page.evaluate(() => window.PocketAuth.login("local-admin"));
  await page.evaluate(async () => {
    const fixture = await (await fetch("/example-plan.json")).json();
    fixture.plans[0].activities[0].start = "2026-10-16";
    const other = structuredClone(fixture.plans[0]);
    other.id = "other-plan";
    other.name = "Other plan";
    other.activities[0].name = "Other activity";
    other.activities[0].status = "Preserve the other plan";
    other.activities[0].progress = 20;
    fixture.plans.push(other);
    const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(fixture)});
    if (!response.ok) throw new Error(await response.text());
  });
  await page.reload();
  const editor = page.locator("#editor");
  const save = page.locator("#editor-form .dialog-actions").getByRole("button", {name: "Save", exact: true});
  const competingWrite = operation => page.evaluate(async operation => {
    const current = await (await fetch("/api/state")).json();
    const plan = current.plans.find(plan => plan.id === "example-plan");
    if (operation === "progress") plan.activities[0].progress = 80;
    if (operation === "close") plan.issues[0].open = false;
    if (operation === "reschedule") plan.activities[0].start = "2026-10-19";
    if (operation === "remove-plan") current.plans = current.plans.filter(plan => plan.id !== "example-plan");
    const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(current)});
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, operation);
  const responseTo = action => {
    const response = page.waitForResponse(result => result.request().method() === "PUT" && /\/api\/(?:state|activities)$/.test(result.url()));
    return action().then(() => response);
  };
  const assertConflict = async (action, expected) => {
    ensure((await responseTo(action)).status() === 409, "A stale write was not rejected");
    await editor.waitFor({state: "hidden"});
    await page.waitForFunction(revision => workspace.revision === revision, expected.revision);
    await page.waitForFunction(() => document.getElementById("toast").textContent.includes("not saved"));
    ensure(JSON.stringify(await state()) === JSON.stringify(expected), "Conflict handling changed another session's saved data");
  };
  const assertClosedGuards = async expected => {
    const count = writes.length;
    let prompted = false;
    const dismiss = async dialog => { prompted = true; await dialog.dismiss(); };
    page.on("dialog", dismiss);
    try {
      await page.evaluate(() => {
        document.getElementById("editor-form").requestSubmit();
        document.getElementById("delete-item").click();
      });
      ensure(JSON.stringify(await state()) === JSON.stringify(expected), "A closed stale editor submitted or deleted data");
      ensure(writes.length === count && !prompted, "Closed editor actions issued a write or confirmation");
    } finally { page.off("dialog", dismiss); }
  };
  const saveEditor = async () => {
    ensure((await responseTo(() => save.click())).ok(), "Saving a fresh edit failed");
    await editor.waitFor({state: "hidden"});
  };
  await page.locator('.activity-name[data-id="example"]').click();
  await page.getByRole("textbox", {name: "Status / description", exact: true}).fill("Intended browser description");
  const progressUpdate = await competingWrite("progress");
  await assertConflict(() => save.click(), progressUpdate);
  await assertClosedGuards(progressUpdate);
  await page.locator('.activity-name[data-id="example"]').click();
  ensure(await page.getByRole("spinbutton", {name: "Progress · %", exact: true}).inputValue() === "80", "Reopening shows stale progress");
  await page.getByRole("textbox", {name: "Status / description", exact: true}).fill("Intended browser description");
  await saveEditor();
  ensure((await state()).plans[0].activities[0].progress === 80, "Description editing overwrote the teammate's progress");
  await page.getByRole("tab", {name: /^Issues/}).click();
  await page.locator(".issue-title").click();
  await page.getByRole("textbox", {name: "Description", exact: true}).fill("Unsaved stale issue description");
  const closed = await competingWrite("close");
  await assertConflict(() => save.click(), closed);
  await assertClosedGuards(closed);
  await page.getByRole("combobox", {name: "Issue status", exact: true}).selectOption("history");
  await page.locator(".issue-title").click();
  ensure(await page.getByRole("button", {name: "Reopen issue", exact: true}).isVisible(), "Reopening details ignored the concurrent closure");
  await page.getByRole("textbox", {name: "Description", exact: true}).fill("Fresh closed-issue description");
  await saveEditor();
  const updatedIssue = (await state()).plans[0].issues[0];
  ensure(updatedIssue.open === false && updatedIssue.resolvedAt === closed.plans[0].issues[0].resolvedAt, "Fresh issue editing reopened it or changed its resolution time");
  await page.getByRole("tab", {name: "Plan", exact: true}).click();
  const bar = page.locator('.bar[data-id="example"]').first();
  const box = await bar.boundingBox();
  const dayWidth = await bar.evaluate(element => element.parentElement.clientWidth / Number(document.getElementById("range-days").value));
  const rescheduled = await competingWrite("reschedule");
  await assertConflict(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dayWidth, box.y + box.height / 2, {steps: 8});
    await page.mouse.up();
  }, rescheduled);
  ensure(await page.locator('.bar[data-id="example"]').getAttribute("data-start") === "2026-10-19", "Drag conflict left the old chart in place");
  await page.waitForFunction(() => !ignoreClick);
  await page.locator('.activity-name[data-id="example"]').click();
  await page.getByRole("textbox", {name: "Status / description", exact: true}).fill("Never apply this draft to the other plan");
  const removed = await competingWrite("remove-plan");
  await assertConflict(() => save.click(), removed);
  await assertClosedGuards(removed);
  ensure(await page.getByRole("combobox", {name: "Active plan", exact: true}).inputValue() === "other-plan", "Deleted plan selection was not refreshed");
  await page.locator('.activity-name[data-id="example"]').click();
  ensure(await page.getByRole("textbox", {name: "Status / description", exact: true}).inputValue() === "Preserve the other plan", "Same item ID caused stale values to cross plan boundaries");
  await page.locator("#cancel-editor").click();
  const large = await page.evaluate(async () => {
    const current = await (await fetch("/api/state")).json();
    const document = {schemaVersion: 1, revision: current.revision, plans: []};
    for (let index = 0; index < 86; index++) document.plans.push({id: `synthetic-${index}`, name: "Synthetic żółć 🍯", description: "x".repeat(12000), streams: [], activityTypes: [], activities: [], issues: []});
    document.plans.push({id: "padding", name: "Synthetic padding", description: "", streams: [], activityTypes: [], activities: [], issues: []});
    const bytes = new TextEncoder().encode(JSON.stringify(document)).length;
    document.plans.at(-1).description = "x".repeat(1024 * 1024 - bytes - 200);
    const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(document)});
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  await page.reload();
  await page.getByRole("tab", {name: "Data", exact: true}).click();
  await page.evaluate(() => {
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = blob => { window.qaExportBlob = blob; return createObjectURL.call(URL, blob); };
  });
  const download = page.waitForEvent("download");
  await page.locator("#export-json").click();
  ensure((await download).suggestedFilename() === "Synthetic żółć 🍯.json", "The export did not use the selected plan's Unicode name");
  const exported = await page.evaluate(async () => {
    const text = await window.qaExportBlob.text();
    const document = JSON.parse(text);
    const transfer = new DataTransfer();
    transfer.items.add(new File([window.qaExportBlob], "Synthetic żółć 🍯.json", {type: "application/json"}));
    window.document.getElementById("import-file").files = transfer.files;
    return {bytes: window.qaExportBlob.size, compact: text === JSON.stringify(document), revision: document.revision, samePlans: JSON.stringify(document.plans) === JSON.stringify(workspace.plans)};
  });
  ensure(exported.compact && exported.bytes <= 1024 * 1024 && exported.bytes > 1024 * 1024 - 300, "Near-limit export is inflated or does not fit the import byte limit");
  ensure(exported.revision === 0 && exported.samePlans, "Export changed plan data or retained the server revision");
  page.once("dialog", dialog => dialog.accept());
  ensure((await responseTo(() => page.locator("#import-json").click())).ok(), "The actual exported JSON could not be imported");
  await page.waitForFunction(() => document.getElementById("import-result").textContent.includes("imported and saved"));
  const imported = await state();
  ensure(imported.revision === large.revision + 1 && JSON.stringify(imported.plans) === JSON.stringify(large.plans), "Export/import lost Unicode or other plan data");
  await page.getByRole("tab", {name: "Data", exact: true}).click();
  const beforeRejected = writes.length;
  for (const [contents, expected] of [["x".repeat(1024 * 1024 + 1), "no larger than"], ["{ invalid", "Import failed"]]) {
    await page.evaluate(contents => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([contents], "invalid.json", {type: "application/json"}));
      document.getElementById("import-file").files = transfer.files;
    }, contents);
    await page.locator("#import-json").click();
    await page.waitForFunction(expected => document.getElementById("import-result").textContent.includes(expected), expected);
  }
  ensure(writes.length === beforeRejected && JSON.stringify(await state()) === JSON.stringify(imported), "Rejected import issued a write or changed persisted data");
  ensure(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
  return {checks: "activity conflict, preserved progress, closed form guards, issue closure, resolution timestamp, drag conflict, removed plan, same IDs across plans, actual near-limit Unicode export/import, rejected imports", exportBytes: exported.bytes, revision: imported.revision};
}
