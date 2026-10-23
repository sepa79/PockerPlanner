import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as calendar from './schedule'
import { makePlan, makeIssues } from './calendar.test-fixtures'
import type { Activity, Issue } from '../api/types'

const affects = (issue: Issue, item: Activity) => issue.scope === "ALL" || (issue.scope === "STREAMS" ? issue.streamIds.includes(item.streamId) : (issue.activityIds ?? []).includes(item.id));
const fixture = () => makePlan({streams: [{id: "first"}, {id: "next", dependsOn: "first"}, {id: "separate"}], activities: [{id: "minimal", streamId: "first", start: "2026-10-13", durationDays: 3, progress: 50}, {id: "heavy", streamId: "first", start: "2026-10-16", durationDays: 3, progress: 0, dependsOn: "minimal"}, {id: "later", streamId: "next", start: "2026-10-30", durationDays: 1, progress: 0}, {id: "independent", streamId: "separate", start: "2026-10-20", durationDays: 2, progress: 0}, {id: "completed", streamId: "separate", start: "2026-10-13", durationDays: 2, progress: 100}], issues: [{id: "blocker", scope: "ACTIVITIES", activityIds: ["minimal"], streamIds: [], discovered: "2026-10-13", blocker: true, open: true}]});

test("normal view counts open blocking through today and cascades without saving", () => {
  const document = fixture();
  const original = JSON.stringify(document);
  const result = calendar.forecast(document, "2026-10-14", affects);
  assert.equal(result.projected.activities.get("minimal")!.start, "2026-10-13");
  assert.equal(result.projected.activities.get("minimal")!.end, "2026-10-16");
  assert.equal(result.projected.activities.get("heavy")!.start, "2026-10-19");
  assert.equal(result.projected.activities.get("later")!.start, "2026-10-22");
  assert.deepEqual(result.projected.activities.get("independent")!.days, ["2026-10-20", "2026-10-21"]);
  assert.equal(result.projected.activities.get("completed")!.end, "2026-10-14");
  assert.equal(JSON.stringify(document), original);
});

test("blocker delay isolates finish slip from progress and cascades through dependencies", () => {
  const document = fixture();
  const result = calendar.forecast(document, "2026-10-14", affects);
  assert.equal(result.blockerDelays.get("minimal")!, 1);
  assert.equal(result.blockerDelays.get("heavy")!, 1);
  assert.equal(result.blockerDelays.get("later")!, 1);
  assert.equal(result.blockerDelays.get("independent")!, 0);
  assert.equal(result.blockerDelays.get("completed")!, 0);
  document.issues.push({...document.issues[0], id: "overlap"});
  assert.equal(calendar.forecast(document, "2026-10-14", affects).blockerDelays.get("minimal")!, 1);
  document.issues = [];
  assert.ok([...calendar.forecast(document, "2026-10-14", affects).blockerDelays.values()].every(delay => delay === 0));
});

test("day changes extend ongoing blocking; closing retains the recorded calendar delay", () => {
  const document = fixture();
  const before = calendar.forecast(document, "2026-10-16", affects);
  assert.equal(before.projected.activities.get("minimal")!.end, "2026-10-20");
  document.issues[0].open = false;
  document.issues[0].resolvedAt = "2026-10-16T11:30:00Z";
  const after = calendar.forecast(document, "2026-10-19", affects);
  assert.equal(after.projected.activities.get("minimal")!.end, before.projected.activities.get("minimal")!.end);
});

test("overlapping blockers are not added together and not-started tasks move as a whole", () => {
  const document = fixture();
  document.activities[0].progress = 0;
  document.issues.push({...document.issues[0], id: "second", discovered: "2026-10-14"});
  const result = calendar.forecast(document, "2026-10-16", affects);
  assert.equal(result.projected.activities.get("minimal")!.start, "2026-10-19");
  assert.equal(result.projected.activities.get("minimal")!.end, "2026-10-21");
});

test("What if compares against the current forecast rather than adding past delays twice", () => {
  const document = fixture();
  const result = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-18"});
  assert.equal(result.current.activities.get("minimal")!.end, "2026-10-16");
  assert.equal(result.projected.activities.get("minimal")!.end, "2026-10-20");
  assert.equal(result.changed.get("minimal")!.end, 4);
});

test("one continuous frame separates paused days, weekends and scheduled progress", () => {
  const document = fixture();
  const schedule = calendar.forecast(document, "2026-10-16", affects).projected.activities.get("minimal")!;
  const frame = calendar.frame(schedule, "2026-10-13", 10, 50)!;
  assert.equal(frame.durationDays, 8);
  assert.deepEqual(frame.gaps, [{kind: "pause", offset: 0, durationDays: 4}, {kind: "weekend", offset: 4, durationDays: 2}]);
  assert.equal(frame.work.length, 1);
  assert.equal(frame.work[0].offset, 6);
});

test("blocking extends visibly into Saturday and Sunday without inventing working days", () => {
  const document = fixture();
  for (const [endDate, blockedDays, weekendDays] of [["2026-10-16", 4, 0], ["2026-10-17", 5, 1], ["2026-10-18", 6, 2]] as const) {
    const result = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate});
    const task = result.projected.activities.get("minimal")!;
    assert.equal(task.end, "2026-10-20");
    for (const schedule of [task, result.projected.streams.get("first")!]) {
      const frame = calendar.frame(schedule, "2026-10-13", 7, 50)!;
      const pauses = frame.gaps.filter(gap => gap.kind === "pause");
      assert.equal(pauses.reduce((sum, gap) => sum + gap.durationDays, 0), blockedDays);
      assert.equal(pauses.filter(gap => gap.weekend).reduce((sum, gap) => sum + gap.durationDays, 0), weekendDays);
      assert.ok(frame.work.every(segment => segment.start >= "2026-10-19"));
    }
  }
  const normal = calendar.forecast(document, "2026-10-17", affects).projected.activities.get("minimal")!;
  const clipped = calendar.frame(normal, "2026-10-17", 2, 50)!;
  assert.deepEqual(clipped.gaps, [{kind: "pause", offset: 0, durationDays: 1, weekend: true}, {kind: "weekend", offset: 1, durationDays: 1}]);
  document.activities[0].includeWeekends = true;
  const opted = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-18"}).projected.activities.get("minimal")!;
  const frame = calendar.frame(opted, "2026-10-13", 7, 50)!;
  assert.equal(frame.gaps[0].kind, "pause");
  assert.equal(frame.gaps[0].durationDays, 6);
  assert.ok(frame.gaps.every(gap => !gap.weekend && gap.kind !== "weekend"));
});

test("weekend opt-in removes hatching; clipped frames and independent stream gaps stay honest", () => {
  const opted = calendar.activity({start: "2026-10-16", durationDays: 3, includeWeekends: true});
  assert.deepEqual(calendar.frame(opted, "2026-10-16", 7, 0)!.gaps, []);
  const weekdays = calendar.activity({start: "2026-10-16", durationDays: 3});
  const clipped = calendar.frame(weekdays, "2026-10-17", 3, 50)!;
  assert.deepEqual(clipped.gaps, [{kind: "weekend", offset: 0, durationDays: 2}]);
  assert.equal(calendar.frame(weekdays, "2026-11-01", 7, 0)!, null);
  const document = makePlan({streams: [{id: "first"}], activities: [{id: "one", streamId: "first", start: "2026-10-16", durationDays: 1}, {id: "two", streamId: "first", start: "2026-10-20", durationDays: 1}]});
  const group = calendar.frame(calendar.plan(document).streams.get("first")!, "2026-10-16", 7, 0)!;
  assert.equal(group.gaps.some(gap => gap.kind === "pause"), false);
  assert.equal(group.gaps.some(gap => gap.kind === "gap"), true);
});

test("known completed pauses remain visible without rescheduling completed work", () => {
  const document = fixture();
  document.activities[4].blockerIntervals = [{issueId: "historical", startedAt: "2026-10-13T09:00:00Z", endedAt: "2026-10-13T12:00:00Z"}];
  const result = calendar.forecast(document, "2026-10-16", affects);
  const completed = result.projected.activities.get("completed")!;
  assert.equal(completed.start, "2026-10-13");
  assert.equal(completed.end, "2026-10-14");
  const frame = calendar.frame(completed, "2026-10-13", 7, 100)!;
  assert.equal(frame.gaps[0].kind, "pause");
  assert.equal(frame.work[0].start, "2026-10-14");
});

test("invalid forecast dates and missing scope policy fail explicitly", () => {
  assert.throws(() => calendar.forecast(fixture(), "2026-02-30", affects), /calendar dates/);
  assert.throws(() => Reflect.apply(calendar.forecast, undefined, [fixture(), "2026-10-14"]), /scope predicate/);
});

test("Started before a future planned date forecasts remaining work from facts", () => {
  const document = makePlan({streams: [{id: "demo"}], activities: [{id: "active", streamId: "demo", start: "2026-10-30", startedAt: "2026-10-14T09:00:00Z", durationDays: 3, progress: 50}], issues: []});
  const original = JSON.stringify(document);
  const result = calendar.forecast(document, "2026-10-14", affects);
  assert.equal(result.projected.activities.get("active")!.start, "2026-10-14");
  assert.equal(result.projected.activities.get("active")!.end, "2026-10-15");
  assert.equal(result.baseline.activities.get("active")!.start, "2026-10-30");
  assert.equal(result.baseline.activities.get("active")!.end, "2026-11-03");
  document.activities[0].progress = 0;
  assert.equal(calendar.forecast(document, "2026-10-14", affects).projected.activities.get("active")!.end, "2026-10-16");
  document.activities[0].progress = 50;
  document.issues = makeIssues([{id: "problem", scope: "ALL", discovered: "2026-10-14", blocker: true, open: true}]);
  assert.equal(calendar.forecast(document, "2026-10-14", affects).projected.activities.get("active")!.end, "2026-10-16");
  document.issues = [];
  assert.equal(JSON.stringify(document), original);
  delete document.activities[0].startedAt;
  document.activities[0].progress = 0;
  assert.equal(calendar.forecast(document, "2026-10-14", affects).projected.activities.get("active")!.start, "2026-10-30");
});

test("Started work still waits for Activity and Stream predecessors", () => {
  const document = makePlan({streams: [{id: "first"}, {id: "next", dependsOn: "first"}], activities: [{id: "predecessor", streamId: "first", start: "2026-10-19", durationDays: 2, progress: 0}, {id: "activity-child", streamId: "first", start: "2026-11-02", durationDays: 3, progress: 50, startedAt: "2026-10-14T09:00:00Z", dependsOn: "predecessor"}, {id: "stream-child", streamId: "next", start: "2026-11-16", durationDays: 3, progress: 50, startedAt: "2026-10-14T09:00:00Z"}], issues: []});
  const result = calendar.forecast(document, "2026-10-14", affects).projected;
  assert.equal(result.activities.get("activity-child")!.end, "2026-10-22");
  assert.equal(result.activities.get("stream-child")!.end, "2026-10-26");
  assert.equal(result.activities.get("stream-child")!.days[0], "2026-10-23");
});

test("collapsed Streams retain independent work while another Activity is paused", () => {
  const document = makePlan({streams: [{id: "demo"}], activities: [{id: "blocked", streamId: "demo", start: "2026-10-13", durationDays: 3, progress: 50}, {id: "working", streamId: "demo", start: "2026-10-14", durationDays: 3, progress: 0}], issues: [{id: "problem", scope: "ACTIVITIES", activityIds: ["blocked"], discovered: "2026-10-14", blocker: true, open: true}]});
  const result = calendar.forecast(document, "2026-10-14", affects).projected;
  const summary = calendar.frame(result.streams.get("demo")!, "2026-10-14", 1, 50)!;
  assert.deepEqual(summary.gaps, []);
  assert.equal(summary.work[0].start, "2026-10-14");
  assert.equal(summary.work[0].progress, 100);
  assert.equal(calendar.frame(result.activities.get("blocked")!, "2026-10-14", 1, 50)!.gaps[0].kind, "pause");
  document.issues[0].activityIds!.push("working");
  document.activities[1].startedAt = "2026-10-14T09:00:00Z";
  const paused = calendar.forecast(document, "2026-10-14", affects).projected;
  assert.equal(calendar.frame(paused.streams.get("demo")!, "2026-10-14", 1, 50)!.gaps[0].kind, "pause");
});

test("collapsed Streams preserve opted-in weekend and recorded completed work", () => {
  const document = makePlan({streams: [{id: "demo"}], activities: [{id: "blocked", streamId: "demo", start: "2026-10-13", durationDays: 3, progress: 50}, {id: "working", streamId: "demo", start: "2026-10-16", durationDays: 3, progress: 0, includeWeekends: true}], issues: [{id: "problem", scope: "ACTIVITIES", activityIds: ["blocked"], discovered: "2026-10-14", blocker: true, open: true}]});
  const projected = calendar.forecast(document, "2026-10-14", affects, {issueId: "problem", endDate: "2026-10-18"}).projected;
  const weekend = calendar.frame(projected.streams.get("demo")!, "2026-10-17", 2, 50)!;
  assert.deepEqual(weekend.gaps, []);
  assert.equal(weekend.work[0].durationDays, 2);
  Object.assign(document.activities[1], {durationDays: 1, progress: 100, startedAt: "2026-10-16T09:00:00Z", completedAt: "2026-10-17T10:00:00Z"});
  const completed = calendar.forecast(document, "2026-10-20", affects).projected;
  const actual = calendar.frame(completed.streams.get("demo")!, "2026-10-17", 1, 75)!;
  assert.deepEqual(actual.gaps, []);
  assert.equal(actual.work[0].start, "2026-10-17");
});

test("recording Done does not change collapsed progress across excluded weekends", () => {
  const document = makePlan({streams: [{id: "demo"}], activities: [{id: "done", streamId: "demo", start: "2026-10-09", durationDays: 1, progress: 100}, {id: "pending", streamId: "demo", start: "2026-10-12", durationDays: 3, progress: 0}], issues: []});
  const before = calendar.frame(calendar.forecast(document, "2026-10-14", affects).projected.streams.get("demo")!, "2026-10-09", 7, 50)!;
  Object.assign(document.activities[0], {startedAt: "2026-10-09T09:00:00Z", completedAt: "2026-10-09T16:00:00Z"});
  const schedule = calendar.forecast(document, "2026-10-14", affects).projected.streams.get("demo")!;
  const frame = calendar.frame(schedule, "2026-10-09", 7, 50)!;
  assert.deepEqual(frame, before);
  assert.equal(frame.work.reduce((sum, segment) => sum + segment.durationDays * segment.progress / 100, 0), 2);
  const clipped = calendar.frame(schedule, "2026-10-13", 2, 50)!;
  assert.equal(clipped.work[0].progress, 0);
});

test("completed summary progress counts actual work once, excluding pauses and idle days", () => {
  const document = makePlan({streams: [{id: "demo"}], activities: [{id: "done", streamId: "demo", start: "2026-10-09", durationDays: 1, progress: 100, startedAt: "2026-10-09T09:00:00Z", completedAt: "2026-10-14T16:00:00Z", blockerIntervals: [{issueId: "historical", startedAt: "2026-10-12T09:00:00Z", endedAt: "2026-10-12T12:00:00Z"}]}, {id: "pending", streamId: "demo", start: "2026-10-19", durationDays: 1, progress: 0}], issues: []});
  const schedule = calendar.forecast(document, "2026-10-14", affects).projected.streams.get("demo")!;
  const frame = calendar.frame(schedule, "2026-10-09", 11, 50)!;
  assert.equal(frame.work.reduce((sum, segment) => sum + segment.durationDays * segment.progress / 100, 0), 2);
  assert.deepEqual(frame.work.map(segment => [segment.start, segment.progress]), [["2026-10-09", 100], ["2026-10-13", 50], ["2026-10-19", 0]]);
  assert.ok(frame.gaps.some(gap => gap.kind === "pause"));
  assert.ok(frame.gaps.some(gap => gap.kind === "gap"));
  assert.equal(calendar.frame(schedule, "2026-10-13", 1, 50)!.work[0].progress, 100);
  Object.assign(document.activities[1], {start: "2026-10-13", durationDays: 2});
  const overlap = calendar.frame(calendar.forecast(document, "2026-10-14", affects).projected.streams.get("demo")!, "2026-10-09", 7, 50)!;
  assert.equal(overlap.work.reduce((sum, segment) => sum + segment.durationDays * segment.progress / 100, 0), 1.5);
});

test("completed summary progress counts opted-in weekends and unions overlapping work", () => {
  const document = makePlan({streams: [{id: "demo"}], activities: [{id: "done", streamId: "demo", start: "2026-10-09", durationDays: 1, includeWeekends: true, progress: 100, startedAt: "2026-10-09T09:00:00Z", completedAt: "2026-10-11T16:00:00Z"}, {id: "pending", streamId: "demo", start: "2026-10-13", durationDays: 1, progress: 0}], issues: []});
  const result = calendar.forecast(document, "2026-10-14", affects).projected;
  const frame = calendar.frame(result.streams.get("demo")!, "2026-10-09", 7, 50)!;
  assert.ok(Math.abs(frame.work.reduce((sum, segment) => sum + segment.durationDays * segment.progress / 100, 0) - 2) < 1e-9);
  assert.ok(frame.gaps.every(gap => gap.kind !== "weekend"));
  assert.equal(calendar.frame(result.streams.get("demo")!, "2026-10-10", 1, 50)!.work[0].progress, 100);
  assert.equal(calendar.frame(result.streams.get("demo")!, "2026-10-11", 1, 50)!.work[0].progress, 0);
  assert.equal(calendar.frame(result.activities.get("done")!, "2026-10-10", 2, 100)!.work[0].progress, 100);
  Object.assign(document.activities[1], {start: "2026-10-09", durationDays: 3, includeWeekends: true});
  const overlap = calendar.frame(calendar.forecast(document, "2026-10-14", affects).projected.streams.get("demo")!, "2026-10-09", 7, 50)!;
  assert.equal(overlap.work.reduce((sum, segment) => sum + segment.durationDays * segment.progress / 100, 0), 1.5);
});

test("long completed summary spans keep work bounded to the visible window", () => {
  const document = makePlan({streams: [{id: "demo"}], activities: [{id: "done", streamId: "demo", start: "2026-10-09", durationDays: 1, progress: 100, startedAt: "1900-01-01T09:00:00Z", completedAt: "9000-01-01T16:00:00Z"}, {id: "pending", streamId: "demo", start: "2026-10-12", durationDays: 3, progress: 0}], issues: []});
  const schedule = calendar.forecast(document, "2026-10-14", affects).projected.streams.get("demo")!;
  assert.ok(schedule.days.length <= 4);
  const early = calendar.frame(schedule, "2026-10-12", 7, 50)!;
  assert.ok(early.work.every(segment => segment.progress === 100));
  const late = calendar.frame(schedule, "8999-12-20", 7, 50)!;
  assert.ok(late.work.every(segment => segment.progress === 0));
});

test("completed summary fill matches its available-day union in every clipped window", () => {
  for (const includeWeekends of [false, true]) {
    const document = makePlan({streams: [{id: "demo"}], activities: [{id: "done", streamId: "demo", start: "2026-10-09", durationDays: 2, includeWeekends, progress: 100, startedAt: "2026-10-09T09:00:00Z", completedAt: "2026-10-16T16:00:00Z", blockerIntervals: [{issueId: "historical", startedAt: "2026-10-10T09:00:00Z", endedAt: "2026-10-12T12:00:00Z"}, {issueId: "historical", startedAt: "2026-10-12T09:00:00Z", endedAt: "2026-10-13T12:00:00Z"}]}, {id: "other-done", streamId: "demo", start: "2026-10-09", durationDays: 1, includeWeekends: !includeWeekends, progress: 100, startedAt: "2026-10-09T09:00:00Z", completedAt: "2026-10-11T16:00:00Z"}, {id: "pending", streamId: "demo", start: "2026-10-15", durationDays: 3, progress: 0}], issues: []});
    const schedule = calendar.forecast(document, "2026-10-14", affects).projected.streams.get("demo")!;
    const workDays = calendar.frame(schedule, "2026-10-09", 14, 0)!.work.flatMap(segment => Array.from({length: segment.durationDays}, (_, offset) => calendar.addDays(segment.start, offset)));
    for (const progress of [0, 25, 50, 67, 100]) {
      const budget = workDays.length * progress / 100;
      for (const windowDays of [1, 3, 7]) {
        for (let offset = 0; offset < 11; offset++) {
          const windowStart = calendar.addDays("2026-10-09", offset);
          const windowEnd = calendar.addDays(windowStart, windowDays);
          const frame = calendar.frame(schedule, windowStart, windowDays, progress)!;
          const actual = frame?.work.reduce((sum, segment) => sum + segment.durationDays * segment.progress / 100, 0) || 0;
          const expected = workDays.reduce((sum, day, index) => sum + (windowStart <= day && day < windowEnd ? Math.max(0, Math.min(1, budget - index)) : 0), 0);
          assert.ok(Math.abs(actual - expected) < 1e-9, `${includeWeekends}, ${progress}%, ${windowStart}, ${windowDays} days`);
        }
      }
    }
  }
});

test("fast progress forecasts earlier completion, without a blocker creating artificial idle days", () => {
  const document = fixture();
  document.activities[0].start = "2026-10-12";
  document.activities[0].durationDays = 10;
  document.activities[0].progress = 90;
  document.issues = [];
  const clear = calendar.forecast(document, "2026-10-14", affects);
  assert.equal(clear.baseline.activities.get("minimal")!.end, "2026-10-23");
  assert.equal(clear.projected.activities.get("minimal")!.end, "2026-10-14");
  document.issues = makeIssues([{id: "blocker", scope: "ALL", discovered: "2026-10-14", blocker: true, open: true}]);
  const blocked = calendar.forecast(document, "2026-10-14", affects);
  assert.equal(blocked.projected.activities.get("minimal")!.end, "2026-10-15");
  assert.equal(document.activities[0].durationDays, 10);
});

test("today is the unchanged default; a selected blocker end is inclusive", () => {
  const document = fixture();
  const unchanged = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-14"});
  assert.equal(unchanged.changed.size, 0);
  const extended = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-16"});
  assert.deepEqual(extended.projected.activities.get("minimal")!.days, ["2026-10-19", "2026-10-20"]);
  assert.equal(extended.projected.streams.get("first")!.start, "2026-10-13");
  assert.equal(extended.projected.activities.get("independent")!.end, unchanged.projected.activities.get("independent")!.end);
});

test("only the selected blocker changes, including overlapping scopes", () => {
  const document = fixture();
  document.issues.push({...document.issues[0], id: "other", activityIds: ["independent"], discovered: "2026-10-14"});
  const result = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-23"});
  assert.equal(result.projected.activities.get("independent")!.start, "2026-10-20");
  document.issues[1].activityIds = ["minimal"];
  const overlap = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-23"});
  assert.equal(overlap.projected.activities.get("minimal")!.end, result.projected.activities.get("minimal")!.end);
});

test("invalid What if inputs fail explicitly", () => {
  for (const extension of [{issueId: "missing", endDate: "2026-10-14"}, {issueId: "blocker", endDate: "2026-10-13"}, {issueId: "blocker", endDate: "2027-10-15"}, {issueId: "blocker", endDate: "2026-02-30"}, {issueId: "blocker", endDate: "2026-10-14", from: "2026-10-13"}]) {
    assert.throws(() => calendar.forecast(fixture(), "2026-10-14", affects, extension));
  }
  const document = fixture();
  document.issues[0].open = false;
  assert.throws(() => calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-14"}), /active blocker/);
  assert.equal(calendar.forecast(makePlan({streams: [], activities: [], issues: []}), "2026-10-14", affects).projectedFinish, null);
});

test("recorded completion fixes the actual frame and releases successors", () => {
  const document = fixture();
  Object.assign(document.activities[0], {progress: 100, startedAt: "2026-10-14T08:00:00Z", completedAt: "2026-10-14T10:00:00Z"});
  const result = calendar.forecast(document, "2026-10-14", affects, {issueId: "blocker", endDate: "2026-10-23"});
  assert.equal(result.projected.activities.get("minimal")!.start, "2026-10-14");
  assert.equal(result.projected.activities.get("minimal")!.end, "2026-10-14");
  assert.equal(result.projected.activities.get("heavy")!.start, "2026-10-15");
  assert.equal(result.baseline.activities.get("minimal")!.end, "2026-10-15");
  assert.equal(calendar.frame(result.projected.activities.get("minimal")!, "2026-10-12", 7, 100)!.work[0].progress, 100);
});

test("very long actual frames are bounded to the visible window", () => {
  const document = fixture();
  Object.assign(document.activities[0], {progress: 100, startedAt: "2020-01-01T09:00:00Z", completedAt: "2026-10-14T10:00:00Z"});
  const schedule = calendar.forecast(document, "2026-10-14", affects).projected.activities.get("minimal")!;
  assert.ok(schedule.days.length <= 365);
  const frame = calendar.frame(schedule, "2026-10-12", 7, 100)!;
  assert.equal(frame.durationDays, 3);
  assert.equal(frame.work[0].progress, 100);
});

test("recorded timestamps use the viewer calendar near UTC midnight", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    assert.equal(calendar.timestampDay("2026-10-14T23:30:00Z"), "2026-10-15");
    const document = fixture();
    Object.assign(document.issues[0], {open: false, resolvedAt: "2026-10-14T23:30:00Z"});
    const schedule = calendar.forecast(document, "2026-10-14", affects).projected.activities.get("minimal")!;
    assert.equal(schedule.days[0], "2026-10-16");
    assert.equal(schedule.end, "2026-10-19");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
