async (page) => {
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(async () => (await fetch("/api/state")).json());
  ensure((await state()).plans.length === 0, "Run only against an isolated server with an empty test database");
  const errors = [];
  const writes = [];
  const releases = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "PUT" && request.url().endsWith("/api/state")) writes.push(request.url()); });
  await page.setViewportSize({width: 1171, height: 1252});
  await page.evaluate(() => window.PocketAuth.login("local-admin"));
  await page.evaluate(async () => {
    const fixture = await (await fetch("/example-plan.json")).json();
    fixture.plans[0].activities.push({...fixture.plans[0].activities[0], id: "second", name: "Second activity", status: "Original second description"});
    const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(fixture)});
    if (!response.ok) throw new Error(await response.text());
  });
  await page.reload();
  const editor = page.locator("#editor");
  const form = page.locator("#editor-form");
  const save = form.getByRole("button", {name: "Save", exact: true});
  const description = page.getByRole("textbox", {name: "Status / description", exact: true});
  const delayWrite = async (failure = null, deferRequest = false) => {
    let captured = false;
    let ready;
    let release;
    let complete;
    const waiting = new Promise(resolve => { ready = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const finished = new Promise(resolve => { complete = resolve; });
    releases.push(release);
    const handler = async route => {
      if (route.request().method() !== "PUT" || captured) { await route.continue(); return; }
      captured = true;
      const response = failure || deferRequest ? null : await route.fetch();
      ready();
      await gate;
      try {
        if (failure === "network") await route.abort("failed");
        else if (failure === "json") await route.fulfill({status: 200, contentType: "application/json", body: "invalid JSON"});
        else if (failure) await route.fulfill({status: failure, contentType: "application/json", body: JSON.stringify({error: `Synthetic HTTP ${failure}`})});
        else await route.fulfill({response: deferRequest ? await route.fetch() : response});
      } finally { complete(); }
    };
    await page.route("**/api/state", handler);
    return {
      waiting,
      resume: async () => {
        release();
        await finished;
        await page.waitForFunction(() => !mutationPending);
        await page.unroute("**/api/state", handler);
      },
    };
  };
  const assertPending = async () => {
    ensure(await form.getAttribute("aria-busy") === "true", "The editor does not announce its pending update");
    ensure(await form.getByRole("button", {name: "Saving…", exact: true}).isDisabled(), "The pending Save button remains enabled");
    ensure(await form.evaluate(element => [...element.querySelectorAll("input, select, textarea, button")].every(control => control.disabled)), "A pending editor control remains enabled");
    const original = await page.evaluate(() => ({kind: editorKind, id: editorId}));
    const before = writes.length;
    let prompted = false;
    const dismiss = async dialog => { prompted = true; await dialog.dismiss(); };
    page.on("dialog", dismiss);
    try {
      await page.evaluate(() => {
        document.getElementById("cancel-editor").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        document.getElementById("close-editor").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        document.getElementById("delete-item").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        document.getElementById("editor-form").requestSubmit();
        openEditor("activity", "second");
      });
      await page.keyboard.press("Escape");
      ensure(await editor.evaluate(element => element.open), "Cancel/Close/Escape dismissed the pending editor");
      ensure(await page.evaluate(original => editorKind === original.kind && editorId === original.id, original), "Another editor replaced a pending draft");
      ensure(writes.length === before && !prompted, "Pending controls submitted another write or deletion prompt");
    } finally { page.off("dialog", dismiss); }
  };
  const saveNormally = async () => {
    const response = page.waitForResponse(result => result.request().method() === "PUT" && result.url().endsWith("/api/state"));
    await save.click();
    ensure((await response).ok(), "A normal save failed");
    await editor.waitFor({state: "hidden"});
  };
  try {
    await page.locator('.activity-name[data-id="example"]').click();
    ensure(await description.getAttribute("maxlength") === "1000", "Activity description does not match the server limit");
    await description.fill("x".repeat(1000));
    await description.press("End");
    await page.keyboard.insertText("y");
    ensure((await description.inputValue()).length === 1000, "Typing exceeded the activity description limit");
    const delayed = await delayWrite();
    await save.click();
    await delayed.waiting;
    await assertPending();
    await page.screenshot({path: "/home/sepa/TestPlanner/.playwright-mcp/editor-pending.png"});
    await page.setViewportSize({width: 390, height: 844});
    const mobile = await editor.evaluate(element => ({width: element.clientWidth, contentWidth: element.scrollWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth}));
    ensure(mobile.contentWidth <= mobile.width && !mobile.pageOverflow, "Pending controls overflow on mobile");
    await page.setViewportSize({width: 1171, height: 1252});
    await delayed.resume();
    await editor.waitFor({state: "hidden"});
    const saved = await state();
    ensure(saved.plans[0].activities[0].status.length === 1000, "Disabling controls lost outgoing form data or rejected the 1,000-character boundary");
    ensure(saved.plans[0].activities[1].status === "Original second description", "The first write changed the second activity");
    const rejected = await page.evaluate(async () => {
      const current = await (await fetch("/api/state")).json();
      current.plans[0].activities[0].status += "x";
      const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(current)});
      return response.status;
    });
    ensure(rejected === 400 && JSON.stringify(await state()) === JSON.stringify(saved), "The server accepted a bypass of its 1,000-character boundary");
    await page.reload();
    await page.locator('.activity-name[data-id="example"]').click();
    ensure((await description.inputValue()).length === 1000, "The boundary description did not survive reload");
    await page.locator("#cancel-editor").click();
    await page.locator('.activity-name[data-id="second"]').click();
    await description.fill("Second draft after first response");
    await saveNormally();
    ensure((await state()).plans[0].activities[1].status === "Second draft after first response", "The next edit was lost after the pending response");
    for (const failure of [403, 500, "json", "network"]) {
      const before = await state();
      await page.locator('.activity-name[data-id="example"]').click();
      const draft = `Retry after ${failure}`;
      await description.fill(draft);
      const delayedFailure = await delayWrite(failure);
      await save.click();
      await delayedFailure.waiting;
      await assertPending();
      await delayedFailure.resume();
      ensure(await editor.evaluate(element => element.open), "A failed save discarded the draft");
      ensure(await description.isEnabled() && await save.isEnabled() && await page.locator("#cancel-editor").isEnabled(), "A failed response left the editor locked");
      ensure(await description.inputValue() === draft && JSON.stringify(await state()) === JSON.stringify(before), "A failed response lost the draft or altered saved data");
      await saveNormally();
      ensure((await state()).plans[0].activities[0].status === draft, "Retry did not save after the lock was released");
    }
    await page.locator('.activity-name[data-id="example"]').click();
    await description.fill("Conflicting draft");
    const conflict = await delayWrite(null, true);
    await save.click();
    await conflict.waiting;
    const competing = await page.evaluate(async () => {
      const current = await (await fetch("/api/state")).json();
      current.plans[0].activities[0].progress = 85;
      const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(current)});
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    });
    await conflict.resume();
    await editor.waitFor({state: "hidden"});
    ensure(JSON.stringify(await state()) === JSON.stringify(competing), "Conflict recovery replayed an old draft");
    await page.locator('.activity-name[data-id="example"]').click();
    ensure(await description.isEnabled() && await save.isEnabled(), "Conflict recovery left controls locked");
    await page.locator("#cancel-editor").click();
    await page.getByRole("tab", {name: "Streams", exact: true}).click();
    await page.locator(".stream-row").click();
    ensure(await page.locator("[name=description]").getAttribute("maxlength") === "2000", "The activity limit reduced stream descriptions");
    await page.locator("#cancel-editor").click();
    await page.getByRole("tab", {name: "Plans", exact: true}).click();
    await page.locator('[data-edit="plan"]').click();
    ensure(await page.locator("[name=description]").getAttribute("maxlength") === "12000", "The activity limit reduced plan descriptions");
    await page.locator("#cancel-editor").click();
    await page.getByRole("tab", {name: /^Issues/}).click();
    await page.locator(".issue-title").click();
    ensure(await page.locator("[name=description]").getAttribute("maxlength") === "2000", "The activity limit reduced issue descriptions");
    for (const action of ["Close issue", "Reopen issue"]) {
      const lifecycle = await delayWrite();
      await page.getByRole("button", {name: action, exact: true}).click();
      await lifecycle.waiting;
      await assertPending();
      await lifecycle.resume();
      await editor.waitFor({state: "hidden"});
      const issue = (await state()).plans[0].issues[0];
      ensure(issue.open === (action === "Reopen issue"), "Disabling hidden fields changed the lifecycle submission");
      if (action === "Close issue") {
        ensure(typeof issue.resolvedAt === "string", "Closing while locked did not record resolution time");
        await page.getByRole("combobox", {name: "Issue status", exact: true}).selectOption("history");
        await page.locator(".issue-title").click();
      }
    }
    await page.getByRole("tab", {name: "Plan", exact: true}).click();
    await page.locator('.activity-name[data-id="second"]').click();
    const deletion = await delayWrite();
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#delete-item").click();
    await deletion.waiting;
    await assertPending();
    await deletion.resume();
    await editor.waitFor({state: "hidden"});
    ensure(!(await state()).plans[0].activities.some(activity => activity.id === "second"), "Deletion failed after restoring controls");
    await page.locator("#auth-button").click();
    await page.locator('.activity-name[data-id="example"]').click();
    ensure(await description.isDisabled() && await page.getByRole("button", {name: "Done", exact: true}).isDisabled(), "Restored controls grant editing to viewers");
    ensure(await page.locator("#cancel-editor").isEnabled() && await page.locator("#close-editor").isEnabled(), "Viewers cannot close details");
    await page.locator("#close-editor").click();
    ensure(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
    return {checks: "delayed Save, pending controls, Cancel/Close/Escape, duplicate submits, editor replacement, 1,000-character save/reload, server bypass rejection, HTTP/JSON/network failure recovery, retries, conflict recovery, other description limits, Close/Reopen, deletion, view-only, mobile", revision: (await state()).revision, mobile};
  } finally { releases.forEach(release => release()); }
}
