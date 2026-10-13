const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");

const browser = {window: {}};
runInNewContext(readFileSync(join(__dirname, "../web/schedule.js"), "utf8"), browser);
const schedule = browser.window.PockerSchedule;
const plain = value => JSON.parse(JSON.stringify(value));
const friday = {start: "2026-10-16", durationDays: 3};

test("missing or false includeWeekends counts full working days and leaves weekends blank", () => {
  for (const item of [friday, {...friday, includeWeekends: false}]) {
    const result = schedule.activity(item);
    assert.deepEqual(plain(result.days), ["2026-10-16", "2026-10-19", "2026-10-20"]);
    assert.deepEqual(plain(result.segments), [{start: "2026-10-16", durationDays: 1, offsetDays: 0}, {start: "2026-10-19", durationDays: 2, offsetDays: 1}]);
    assert.equal(result.start, "2026-10-16");
    assert.equal(result.end, "2026-10-20");
    assert.equal(item.start, "2026-10-16");
    assert.equal(item.durationDays, 3);
  }
});

test("including weekends uses all calendar days", () => {
  const result = schedule.activity({...friday, includeWeekends: true});
  assert.deepEqual(plain(result.days), ["2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.deepEqual(plain(result.segments), [{start: "2026-10-16", durationDays: 3, offsetDays: 0}]);
  assert.equal(result.end, "2026-10-18");
});

test("weekend starts move to Monday only for weekday schedules", () => {
  for (const start of ["2026-10-17", "2026-10-18"]) {
    assert.equal(schedule.activity({start, durationDays: 1}).start, "2026-10-19");
    assert.equal(schedule.activity({start, durationDays: 1}).end, "2026-10-19");
    assert.equal(schedule.activity({start, durationDays: 1, includeWeekends: true}).start, start);
    assert.equal(schedule.workingStart(start), "2026-10-19");
    assert.equal(schedule.workingStart(start, true), start);
  }
});

test("calendar math handles DST, leap days and year boundaries in UTC", () => {
  assert.equal(schedule.activity({start: "2026-03-27", durationDays: 3}).end, "2026-03-31");
  assert.equal(schedule.activity({start: "2026-10-23", durationDays: 3}).end, "2026-10-27");
  assert.equal(schedule.activity({start: "2024-02-28", durationDays: 3}).end, "2024-03-01");
  assert.equal(schedule.activity({start: "2026-12-31", durationDays: 3}).end, "2027-01-04");
  assert.equal(schedule.dayDiff("2026-03-27", "2026-03-31"), 4);
});

test("365 planned weekdays retain their full duration across many weekends", () => {
  const result = schedule.activity({start: "2026-01-01", durationDays: 365});
  assert.equal(result.days.length, 365);
  assert.ok(result.days.every(day => !schedule.isWeekend(day)));
  assert.ok(schedule.dayDiff(result.start, result.end) > 365);
  assert.equal(result.segments.reduce((total, segment) => total + segment.durationDays, 0), 365);
});

test("progress is distributed over scheduled days, never over the weekend gap", () => {
  const segments = schedule.visibleSegments(schedule.activity(friday), "2026-10-16", 7, 50);
  assert.deepEqual(plain(segments), [
    {start: "2026-10-16", end: "2026-10-16", offset: 0, durationDays: 1, progress: 100},
    {start: "2026-10-19", end: "2026-10-20", offset: 3, durationDays: 2, progress: 25},
  ]);
});

test("clipping handles a view starting inside a segment or in its weekend gap", () => {
  const planned = schedule.activity(friday);
  assert.deepEqual(plain(schedule.visibleSegments(planned, "2026-10-17", 2, 50)), []);
  assert.deepEqual(plain(schedule.visibleSegments(planned, "2026-10-20", 7, 50)), [
    {start: "2026-10-20", end: "2026-10-20", offset: 0, durationDays: 1, progress: 0},
  ]);
  assert.deepEqual(plain(schedule.visibleSegments(planned, "2026-10-15", 2, 0)), [
    {start: "2026-10-16", end: "2026-10-16", offset: 1, durationDays: 1, progress: 0},
  ]);
});

test("summary shows only actual scheduled days and respects individual weekend opt-ins", () => {
  assert.deepEqual(plain(schedule.summary([]).segments), []);
  const weekdays = schedule.summary([friday, {...friday, start: "2026-10-19", durationDays: 1}]);
  assert.deepEqual(plain(weekdays.days), ["2026-10-16", "2026-10-19", "2026-10-20"]);
  const mixed = schedule.summary([friday, {...friday, includeWeekends: true}]);
  assert.deepEqual(plain(mixed.days), ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
  assert.deepEqual(plain(mixed.segments), [{start: "2026-10-16", durationDays: 5, offsetDays: 0}]);
});
