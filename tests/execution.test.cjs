const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {after, test} = require("node:test");
const {runInNewContext} = require("node:vm");

const originalTimezone = process.env.TZ;
process.env.TZ = "Europe/London";
after(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

function fixture(item, initialTime = "2026-10-15T10:00:00Z") {
  let currentTime = initialTime;
  const controls = Object.fromEntries(["activity-started", "progress-done", "field-progress", "field-progress-slider", "field-startedAt", "field-completedAt", "field-startedAt-offset", "field-completedAt-offset", "execution-hint"].map(id => {
    const listeners = {};
    return [id, {
      value: "", validity: {valid: true}, dataset: {},
      setCustomValidity(message) { this.validationMessage = message; this.validity.valid = !message; },
      setAttribute(name, value) { this[name] = value; },
      closest() { return this; },
      addEventListener(kind, callback) { listeners[kind] = callback; },
      emit(kind) { listeners[kind](); },
      focus() {}
    }];
  }));
  controls["field-progress"].value = String(item.progress);
  const browser = {window: {}, Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
  }};
  runInNewContext(readFileSync(join(__dirname, "../web/execution.js"), "utf8"), browser);
  const editor = browser.window.PocketExecution({root: {querySelector: selector => controls[selector.slice(1)]}, item, changed: () => {}, editable: () => true});
  return {editor, controls, clock: value => { currentTime = value; }, enter: (id, value) => { controls[id].value = value; controls[id].emit("input"); }};
}

test("unchanged execution dates preserve their UTC instants across the repeated local hour", () => {
  const item = {progress: 100, startedAt: "2025-10-26T00:45:00.123Z", completedAt: "2025-10-26T01:15:00.456Z"};
  const {editor, controls} = fixture(item);
  assert.ok(controls["field-startedAt"].value > controls["field-completedAt"].value);
  assert.equal(editor.valid(), true);
  assert.equal(editor.preview().startedAt, item.startedAt);
  assert.equal(editor.preview().completedAt, item.completedAt);
  assert.deepEqual(Object.keys(editor.changes()), []);
});

test("Done then Started uses one prospective save time, not the order of clicks", () => {
  const {editor, controls, clock} = fixture({progress: 0});
  controls["progress-done"].emit("click");
  clock("2026-10-15T10:00:02Z");
  controls["activity-started"].emit("click");
  assert.ok(controls["field-startedAt"].value > controls["field-completedAt"].value);
  assert.equal(editor.valid(), true);
  assert.equal(editor.preview().startedAt, editor.preview().completedAt);
  assert.equal(editor.preview().startedAt, "2026-10-15T10:00:02.000Z");
  assert.deepEqual(JSON.parse(JSON.stringify(editor.changes())), {started: true, done: true});
});

test("automatic Started cannot follow an explicitly backdated Done", () => {
  const {editor, controls, enter} = fixture({progress: 0});
  controls["progress-done"].emit("click");
  enter("field-completedAt", "2026-10-14T10:00");
  controls["activity-started"].emit("click");
  assert.equal(editor.valid(), false);
  assert.match(controls["field-completedAt"].validationMessage, /cannot precede/);
  enter("field-startedAt", "2026-10-13T10:00");
  assert.equal(editor.valid(), true);
  assert.equal(editor.changes().startedAt, "2026-10-13T09:00:00.000Z");
  assert.equal(editor.changes().completedAt, "2026-10-14T09:00:00.000Z");
});

test("future validation compares instants rather than repeated-hour clock labels", () => {
  const past = fixture({progress: 50, startedAt: "2025-10-26T00:45:00Z"}, "2025-10-26T01:15:00Z");
  assert.equal(past.editor.valid(), true);
  const future = fixture({progress: 50, startedAt: "2025-10-26T01:15:00Z"}, "2025-10-26T00:45:00Z");
  assert.equal(future.editor.valid(), false);
  assert.match(future.controls["field-startedAt"].validationMessage, /future/);
});

test("explicit future and nonexistent local dates remain invalid", () => {
  const {editor, controls, enter} = fixture({progress: 50, startedAt: "2026-10-12T10:00:00Z"});
  enter("field-startedAt", "2026-10-16T10:00");
  assert.equal(editor.valid(), false);
  assert.match(controls["field-startedAt"].validationMessage, /future/);
  enter("field-startedAt", "2026-03-29T01:30");
  assert.equal(editor.valid(), false);
  assert.match(controls["field-startedAt"].validationMessage, /valid local/);
});

test("correcting a repeated finish preserves its recorded occurrence in preview and payload", () => {
  for (const [completedAt, expected, offset] of [["2025-10-26T00:50:00Z", "2025-10-26T00:55:00.000Z", "-60"], ["2025-10-26T01:50:00Z", "2025-10-26T01:55:00.000Z", "0"]]) {
    const {editor, controls, enter} = fixture({progress: 100, startedAt: "2025-10-26T00:45:00Z", completedAt});
    enter("field-completedAt", "2025-10-26T01:55");
    assert.equal(editor.valid(), true);
    assert.equal(controls["field-completedAt-offset"].value, offset);
    assert.equal(editor.preview().completedAt, expected);
    assert.equal(editor.changes().completedAt, expected);
  }
});

test("correcting a repeated start also retains the recorded occurrence", () => {
  const {editor, enter} = fixture({progress: 100, startedAt: "2025-10-26T01:10:00Z", completedAt: "2025-10-26T01:50:00Z"});
  enter("field-startedAt", "2025-10-26T01:05");
  assert.equal(editor.valid(), true);
  assert.equal(editor.preview().startedAt, "2025-10-26T01:05:00.000Z");
  assert.equal(editor.changes().startedAt, "2025-10-26T01:05:00.000Z");
});

test("an occurrence can change without changing its local clock label", () => {
  const item = {progress: 100, startedAt: "2025-10-26T00:45:00.123Z", completedAt: "2025-10-26T01:50:00.456Z"};
  const {editor, controls} = fixture(item);
  controls["field-completedAt-offset"].value = "-60";
  controls["field-completedAt-offset"].emit("change");
  assert.equal(editor.valid(), true);
  assert.equal(editor.preview().completedAt, "2025-10-26T00:50:00.000Z");
  assert.equal(editor.changes().completedAt, "2025-10-26T00:50:00.000Z");
  controls["field-completedAt-offset"].value = "0";
  controls["field-completedAt-offset"].emit("change");
  assert.equal(editor.preview().completedAt, item.completedAt);
  assert.deepEqual(Object.keys(editor.changes()), []);
});

test("a newly entered repeated time needs an explicit occurrence", () => {
  const {editor, controls, enter} = fixture({progress: 0});
  controls["activity-started"].emit("click");
  enter("field-startedAt", "2025-10-26T01:30");
  assert.equal(editor.valid(), false);
  assert.match(controls["field-startedAt"].validationMessage, /UTC offset/);
  controls["field-startedAt-offset"].value = "0";
  controls["field-startedAt-offset"].emit("change");
  assert.equal(editor.valid(), true);
  assert.equal(editor.changes().startedAt, "2025-10-26T01:30:00.000Z");
  enter("field-startedAt", "2026-06-01T10:00");
  assert.equal(editor.changes().startedAt, "2026-06-01T09:00:00.000Z");
  assert.equal(controls["field-startedAt-offset"].hidden, true);
  enter("field-startedAt", "2025-10-26T01:30");
  assert.equal(editor.valid(), false);
});

test("a different date cannot silently reuse the stored seasonal offset", () => {
  const {editor, controls, enter} = fixture({progress: 50, startedAt: "2025-10-25T09:00:00Z"});
  enter("field-startedAt", "2025-10-26T01:30");
  assert.equal(editor.valid(), false);
  assert.equal(controls["field-startedAt-offset"].value, "");
});

test("choosing a later occurrence still enforces future-time validation", () => {
  const {editor, controls, enter} = fixture({progress: 50, startedAt: "2025-10-26T00:40:00Z"}, "2025-10-26T00:45:00Z");
  enter("field-startedAt", "2025-10-26T01:30");
  assert.equal(editor.valid(), true);
  controls["field-startedAt-offset"].value = "0";
  controls["field-startedAt-offset"].emit("change");
  assert.equal(editor.valid(), false);
  assert.match(controls["field-startedAt"].validationMessage, /future/);
});

test("automatic dates in the repeated hour need no manual occurrence", () => {
  const {editor, controls} = fixture({progress: 0}, "2025-10-26T01:15:00Z");
  controls["progress-done"].emit("click");
  controls["activity-started"].emit("click");
  assert.equal(editor.valid(), true);
  assert.equal(editor.preview().completedAt, "2025-10-26T01:15:00.000Z");
  assert.equal(editor.preview().startedAt, editor.preview().completedAt);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.changes())), {started: true, done: true});
});

test("half-hour clock changes preserve the recorded offset without assuming a one-hour shift", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Australia/Lord_Howe";
  try {
    const {editor, controls, enter} = fixture({progress: 100, startedAt: "2025-04-05T14:35:00Z", completedAt: "2025-04-05T15:15:00Z"});
    assert.match(controls["field-completedAt"].value, /T01:45/);
    enter("field-completedAt", "2025-04-06T01:50");
    assert.equal(editor.valid(), true);
    assert.equal(editor.preview().completedAt, "2025-04-05T15:20:00.000Z");
    assert.equal(editor.changes().completedAt, "2025-04-05T15:20:00.000Z");
  } finally { process.env.TZ = previous; }
});
