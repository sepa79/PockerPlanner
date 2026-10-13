const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");

const browser = {window: {}};
runInNewContext(readFileSync(join(__dirname, "../web/progress.js"), "utf8"), browser);
const progress = browser.window.PockerProgress;

test("empty streams have no progress rather than a fabricated percentage", () => {
  assert.equal(progress([]), null);
});

test("overall progress is a rounded equal-weight mean of every activity", () => {
  assert.equal(progress([{progress: 75, durationDays: 3}, {progress: 0, durationDays: 1}]), 38);
  assert.equal(progress([{progress: 50}, {progress: 0}, {progress: 0}]), 17);
  assert.equal(progress([{progress: 100}, {progress: 0}]), 50);
});

test("zero and complete progress remain exact", () => {
  assert.equal(progress([{progress: 0}, {progress: 0}]), 0);
  assert.equal(progress([{progress: 100}, {progress: 100}]), 100);
});
