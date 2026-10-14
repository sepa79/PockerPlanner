async (page) => {
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const fixture = await page.evaluate(async () => (await fetch("/example-plan.json")).json());
  const plan = fixture.plans[0];
  const base = plan.activities[0];
  plan.issues = [];
  plan.activities = [
    {...base, id: "done", name: "Completed activity", issueIds: [], start: "2026-10-09", durationDays: 1, progress: 100, startedAt: "2026-10-09T09:00:00Z", completedAt: "2026-10-09T16:00:00Z"},
    {...base, id: "pending", name: "Pending activity", issueIds: [], start: "2026-10-12", durationDays: 3, progress: 0}
  ];
  const errors = [];
  let mutations = 0;
  page.on("pageerror", error => errors.push(error.message));
  const intercept = route => {
    ensure(route.request().method() === "GET", "This regression must never save plan data");
    return route.fulfill({json: fixture});
  };
  const observe = request => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations++; };
  const abortEvents = route => route.abort();
  page.on("request", observe);
  await page.route("**/api/state", intercept);
  await page.route("**/api/events", abortEvents);
  const filledDays = () => page.evaluate(() => Array.from(document.querySelectorAll(".stream-summary-fill"), element => parseFloat(element.style.width) / dayWidth).reduce((sum, value) => sum + value, 0));
  try {
    await page.setViewportSize({width: 1171, height: 900});
    await page.reload();
    await page.waitForFunction(() => typeof planner !== "undefined" && planner?.id === "example-plan");
    await page.evaluate(() => { today = () => "2026-10-14"; timelineStart = "2026-10-09"; visibleDays = 7; render(); });
    await page.getByRole("button", {name: "Collapse Example stream", exact: true}).click();
    ensure(await page.locator(".stream-progress").innerText() === "50%", "Unexpected aggregate progress");
    const recordedFill = await filledDays();
    ensure(Math.abs(recordedFill - 2) < 1e-4, "Recorded Done fills something other than half the four working days");
    ensure(await page.locator(".stream-summary .bar-gap.weekend").count() === 1, "Non-working weekend was lost");
    await page.screenshot({path: "/tmp/pocketplanner-completed-progress-desktop.png"});
    await page.evaluate(() => { delete planner.activities[0].startedAt; delete planner.activities[0].completedAt; render(); });
    ensure(Math.abs(await filledDays() - recordedFill) < 1e-4, "Recording Done changes progress without changing scheduled work");
    await page.evaluate(() => { Object.assign(planner.activities[0], {startedAt: "2026-10-09T09:00:00Z", completedAt: "2026-10-09T16:00:00Z"}); timelineStart = "2026-10-13"; render(); });
    ensure(await filledDays() === 0, "Clipping restarts progress on later days");
    await page.evaluate(() => { timelineStart = "2026-10-09"; render(); });
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => render());
    ensure(Math.abs(await filledDays() - 2) < 1e-4, "Mobile changes completed progress");
    ensure(await page.locator("#gantt").evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Mobile timeline overflows horizontally");
    await page.screenshot({path: "/tmp/pocketplanner-completed-progress-mobile.png"});
    await page.setViewportSize({width: 1171, height: 900});
    await page.evaluate(() => {
      Object.assign(planner.activities[0], {includeWeekends: true, completedAt: "2026-10-11T16:00:00Z"});
      Object.assign(planner.activities[1], {start: "2026-10-13", durationDays: 1});
      render();
    });
    ensure(Math.abs(await filledDays() - 2) < 1e-4, "Working weekends are missing or counted twice");
    ensure(await page.locator(".stream-summary .bar-gap.weekend").count() === 0, "Opted-in weekend is shown as non-working");
    await page.evaluate(() => {
      Object.assign(planner.activities[0], {includeWeekends: false, completedAt: "2026-10-14T16:00:00Z", blockerIntervals: [{startedAt: "2026-10-12T09:00:00Z", endedAt: "2026-10-12T12:00:00Z"}]});
      Object.assign(planner.activities[1], {start: "2026-10-19", durationDays: 1});
      visibleDays = 14;
      render();
    });
    ensure(Math.abs(await filledDays() - 2) < 1e-4, "Pauses or idle gaps distort completed progress");
    ensure(await page.locator(".stream-summary .bar-gap.pause").count() === 1, "Recorded pause was lost");
    ensure(await page.locator(".stream-summary .bar-gap.gap").count() === 1, "Unscheduled work gap was lost");
    ensure(mutations === 0, "Browser regression submitted a mutation");
    ensure(!errors.length, `Browser errors: ${errors.join("; ")}`);
    return {checks: "Recorded Done, equal fill before/after timestamps, working/non-working weekends, pauses, idle gaps, clipping, desktop/mobile", recordedFill, mutations};
  } finally {
    page.off("request", observe);
    await page.unroute("**/api/state", intercept);
    await page.unroute("**/api/events", abortEvents);
  }
}
