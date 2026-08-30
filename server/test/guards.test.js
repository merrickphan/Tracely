/**
 * detectGate — the change gate must be LIVE: unchanged text never re-runs,
 * sub-minDelta edits never re-run, and the interval floor holds regardless.
 * (The original conjunction made minDelta dead code; these tests pin the fix.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUARDS, detectGate, rollingCounter } from "../shared/guards.js";

const T = (n, ch = "a") => ch.repeat(n);
const AFTER_FLOOR = GUARDS.detect.minIntervalMs + 1;

test("detectGate: drafts below minChars never run", () => {
  const g = detectGate();
  assert.equal(g.shouldRun(T(GUARDS.detect.minChars - 1), 0), false);
});

test("detectGate: first run on a long-enough draft is allowed", () => {
  const g = detectGate();
  // a real clock is far past the gate's initial lastRunAt of 0
  assert.equal(g.shouldRun(T(100), AFTER_FLOOR), true);
});

test("detectGate: unchanged text never re-runs, even after the interval floor", () => {
  const g = detectGate();
  const text = T(100);
  g.stamp(text, 0);
  assert.equal(g.shouldRun(text, AFTER_FLOOR), false);
});

test("detectGate: an edit below minDelta does not re-run — the change gate is live", () => {
  const g = detectGate();
  const text = T(100);
  g.stamp(text, 0);
  assert.equal(g.shouldRun(`${text}b`, AFTER_FLOOR), false); // 1-char edit
  assert.equal(g.shouldRun(text + T(GUARDS.detect.minDelta - 1, "b"), AFTER_FLOOR), false);
});

test("detectGate: a change of at least minDelta re-runs once the floor lifts", () => {
  const g = detectGate();
  // Base long enough that the shrunken draft stays above minChars.
  const base = GUARDS.detect.minChars + GUARDS.detect.minDelta + 20;
  const text = T(base);
  g.stamp(text, 0);
  assert.equal(g.shouldRun(text + T(GUARDS.detect.minDelta, "b"), AFTER_FLOOR), true); // grew
  assert.equal(g.shouldRun(T(base - GUARDS.detect.minDelta), AFTER_FLOOR), true); // shrank
});

test("detectGate: the interval floor blocks even large changes until it lifts", () => {
  const g = detectGate();
  const text = T(100);
  g.stamp(text, 0);
  const grown = text + T(GUARDS.detect.minDelta + 10, "b");
  assert.equal(g.shouldRun(grown, GUARDS.detect.minIntervalMs - 1), false);
  assert.equal(g.shouldRun(grown, AFTER_FLOOR), true);
});

test("rollingCounter: limit applies within the window", () => {
  const c = rollingCounter(2, 1_000_000_000); // window far larger than test runtime
  assert.equal(c.ok(), true);
  c.stamp();
  c.stamp();
  assert.equal(c.ok(), false);
  assert.equal(c.count(), 2);
});
