const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");

function fixture() {
  let current = 0;
  let blocked = false;
  let source;
  let reads = 0;
  let response = () => Promise.resolve({ok: true, json: async () => ({revision: 1, plans: []})});
  const applied = [];
  const statuses = [];
  const timers = new Map();
  const listeners = {};
  const browser = {window: {addEventListener: (kind, callback) => { listeners[kind] = callback; }}, EventSource: class {
    constructor() { source = this; this.listeners = {}; }
    addEventListener(kind, callback) { this.listeners[kind] = callback; }
    close() { this.closed = true; }
  }, fetch: () => { reads++; return response(); }, setTimeout: callback => { const key = timers.size + 1; timers.set(key, callback); return key; }, clearTimeout: key => timers.delete(key)};
  runInNewContext(readFileSync(join(__dirname, "../web/live.js"), "utf8"), browser);
  const client = browser.window.PocketLive({revision: () => current, blocked: () => blocked, apply: document => { current = document.revision; applied.push(current); }, status: value => statuses.push(value)});
  return {client, source, applied, statuses, timers, listeners, reads: () => reads, current: value => { current = value; }, block: value => { blocked = value; }, reply: value => { response = value; }, emit: value => source.listeners.revision({data: JSON.stringify({revision: value})})};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("committed revisions trigger one canonical read and duplicate/older events do not reload", async () => {
  const view = fixture();
  view.emit(1);
  await settle();
  assert.deepEqual(view.applied, [1]);
  view.emit(1);
  view.emit(0);
  assert.equal(view.reads(), 1);
  view.client.stop();
});

test("an open editor or drag queues updates until it closes without rebasing its draft", async () => {
  const view = fixture();
  view.block(true);
  view.emit(1);
  assert.equal(view.reads(), 0);
  assert.equal(view.statuses.at(-1), "pending");
  view.block(false);
  await view.client.flush();
  assert.deepEqual(view.applied, [1]);
  view.client.stop();
});

test("an editor opened during a snapshot fetch keeps the snapshot queued", async () => {
  const view = fixture();
  let deliver;
  view.reply(() => new Promise(resolve => { deliver = resolve; }));
  view.emit(1);
  view.block(true);
  deliver({ok: true, json: async () => ({revision: 1, plans: []})});
  await settle();
  assert.deepEqual(view.applied, []);
  view.reply(() => Promise.resolve({ok: true, json: async () => ({revision: 1, plans: []})}));
  view.block(false);
  await view.client.flush();
  assert.deepEqual(view.applied, [1]);
  view.client.stop();
});

test("a delayed snapshot cannot overwrite a newer local save", async () => {
  const view = fixture();
  let deliver;
  view.reply(() => new Promise(resolve => { deliver = resolve; }));
  view.emit(1);
  view.current(2);
  deliver({ok: true, json: async () => ({revision: 1, plans: []})});
  await settle();
  assert.deepEqual(view.applied, []);
  view.client.stop();
});

test("snapshot failures are visible and retained revisions can be retried", async () => {
  const view = fixture();
  view.reply(() => Promise.resolve({ok: false}));
  view.emit(1);
  await settle();
  assert.equal(view.statuses.at(-1), "unavailable");
  assert.equal(view.timers.size, 1);
  view.reply(() => Promise.resolve({ok: true, json: async () => ({revision: 1, plans: []})}));
  await view.client.flush();
  assert.deepEqual(view.applied, [1]);
  view.client.stop();
});

test("connection loss remains visible even when a local save flushes queued state", async () => {
  const view = fixture();
  view.emit(0);
  view.source.onerror();
  await view.client.flush();
  assert.equal(view.statuses.at(-1), "unavailable");
  view.source.listeners.unavailable();
  view.emit(0);
  assert.equal(view.statuses.at(-1), "live");
  view.client.stop();
});

test("invalid journal-style notifications never become successful planner updates", async () => {
  const view = fixture();
  view.emit("bad");
  assert.equal(view.reads(), 0);
  assert.equal(view.statuses.at(-1), "unavailable");
  view.reply(() => Promise.resolve({ok: true, json: async () => ({revision: 0, plans: []})}));
  view.emit(1);
  await settle();
  assert.deepEqual(view.applied, []);
  assert.equal(view.statuses.at(-1), "unavailable");
  view.client.stop();
});

test("offline and page lifecycle events close subscriptions and do not apply late snapshots", async () => {
  const view = fixture();
  view.emit(0);
  view.listeners.offline();
  assert.equal(view.source.closed, true);
  assert.equal(view.statuses.at(-1), "unavailable");
  view.listeners.online();
  assert.equal(view.statuses.at(-1), "connecting");
  let deliver;
  view.reply(() => new Promise(resolve => { deliver = resolve; }));
  view.emit(1);
  view.listeners.pagehide();
  deliver({ok: true, json: async () => ({revision: 1, plans: []})});
  await settle();
  assert.deepEqual(view.applied, []);
  view.client.stop();
});
