async (page) => {
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(async () => (await fetch("/api/state")).json());
  ensure((await state()).plans.length === 0, "Run only against an empty isolated QA database");
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({width: 1171, height: 900});
  await page.evaluate(async () => {
    await window.PocketAuth.login("local-admin");
    const fixture = await (await fetch("/example-plan.json")).json();
    fixture.revision = (await (await fetch("/api/state")).json()).revision;
    const plan = fixture.plans[0];
    const base = plan.activities[0];
    plan.activities = [
      {...base, id: "blocked", name: "Blocked activity", start: "2026-10-13", durationDays: 3, progress: 50},
      {...base, id: "working", name: "Independent work", issueIds: [], start: "2026-10-14", durationDays: 3, progress: 25, startedAt: "2026-10-13T09:00:00Z"},
      {...base, id: "early", name: "Started ahead of plan", issueIds: [], start: "2026-10-30", durationDays: 3, progress: 50, startedAt: "2026-10-13T09:00:00Z"}
    ];
    Object.assign(plan.issues[0], {scope: "ACTIVITIES", activityIds: ["blocked"], streamIds: [], discovered: "2026-10-14", blocker: true});
    const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(fixture)});
    if (!response.ok) throw new Error("Failed to prepare isolated review fixture");
  });
  await page.reload();
  await page.waitForFunction(() => typeof planner !== "undefined" && planner?.id);
  await page.evaluate(() => { today = () => "2026-10-14"; timelineStart = "2026-10-13"; visibleDays = 7; render(); });
  const before = JSON.stringify(await state());
  const invalidResponses = await page.evaluate(async () => {
    const saved = await (await fetch("/api/state")).json();
    const activity = saved.plans[0].activities.find(item => item.id === "blocked");
    const responses = [];
    for (const progress of ["50", null, {}, []]) {
      const response = await fetch("/api/activities", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify({planId: "example-plan", activityId: "blocked", item: {...activity, progress}, expectedRevision: saved.revision})});
      responses.push({status: response.status, error: (await response.json()).error});
    }
    return responses;
  });
  ensure(invalidResponses.every(response => response.status === 400 && response.error === "Progress must be 0–100"), "Invalid progress still causes a server error");
  ensure(await page.locator('.bar[data-id="early"]').getAttribute("data-end") === "2026-10-15", "Recorded Started still waits for the later planned start");
  ensure(await page.locator('.bar[data-id="working"] .bar-gap.pause').count() === 0, "Independent work is unexpectedly blocked");
  ensure(await page.locator('.bar[data-id="blocked"] .bar-gap.pause').count() === 1, "The genuine Activity pause was lost");
  await page.getByRole("button", {name: "Collapse Example stream", exact: true}).click();
  ensure(await page.locator(".stream-summary .bar-gap.pause").count() === 0, "One member's blocker hides available Stream work");
  const frame = await page.evaluate(() => window.PocketSchedule.frame(schedules.streams.get("demo"), "2026-10-14", 1, window.PocketProgress(planner.activities)));
  ensure(frame.work.length === 1 && frame.work[0].progress > 0, "Collapsed progress loses the available working day");
  await page.screenshot({path: "/tmp/pocketplanner-review-fixes-stream.png"});
  await page.getByRole("button", {name: "Expand Example stream", exact: true}).click();
  await page.locator('.activity-name[data-id="early"]').click();
  ensure(await page.locator("#field-start").inputValue() === "2026-10-30", "Forecast rewrote the authored estimate date");
  ensure((await page.locator("#activity-timing").innerText()).includes("Projected 15 Oct"), "Activity details use the wrong forecast");
  ensure(await page.locator("#activity-started").isDisabled(), "Recorded Started became editable");
  await page.setViewportSize({width: 390, height: 844});
  ensure(await page.locator("#editor").evaluate(element => element.scrollWidth <= element.clientWidth), "Regression editor overflows on mobile");
  await page.screenshot({path: "/tmp/pocketplanner-review-fixes-mobile.png"});
  await page.locator("#cancel-editor").click();
  ensure(JSON.stringify(await state()) === before, "Viewing forecasts or rejecting invalid input changed persisted state");
  ensure(!errors.length, `Browser errors: ${errors.join("; ")}`);
  return {checks: "Started before plan, preserved estimates/facts, selective blocker scope, collapsed available work/progress, HTTP 400, unchanged saved state, mobile", invalidResponses, frame};
}
