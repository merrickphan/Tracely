import { test } from "node:test";
import assert from "node:assert/strict";
import { RUBRIC, FLAG_CLAUSES, GRADE_COMPONENTS, sumComponents, applyGradeLevel, letterFor } from "../shared/rubric.js";
import { PROBLEM_KINDS } from "../shared/marks.js";

test("every flag kind names a rubric clause (total mapping — a new kind fails here until someone names its clause)", () => {
  for (const { kind } of PROBLEM_KINDS) {
    assert.ok(FLAG_CLAUSES[kind], `flag kind "${kind}" has no rubric clause`);
  }
});

test("every named clause is a verbatim substring of the rubric text under the section it claims", () => {
  for (const [kind, { section, clause }] of Object.entries(FLAG_CLAUSES)) {
    const sec = RUBRIC[section];
    assert.ok(sec, `flag "${kind}" names unknown rubric section "${section}"`);
    assert.ok(
      sec.text.includes(clause),
      `flag "${kind}": clause is not verbatim in RUBRIC.${section}.text:\n  "${clause}"`
    );
  }
});

test("component points sum to 100", () => {
  const total = GRADE_COMPONENTS.reduce((n, k) => n + RUBRIC[k].points, 0);
  assert.equal(total, 100);
});

test("sumComponents: full marks → 100", () => {
  const components = Object.fromEntries(GRADE_COMPONENTS.map((k) => [k, { score: RUBRIC[k].points }]));
  assert.equal(sumComponents(components), 100);
});

test("counterargument leaves the denominator entirely when absent", () => {
  const full = Object.fromEntries(GRADE_COMPONENTS.map((k) => [k, { score: RUBRIC[k].points }]));
  full.counterargument = { absent: true, score: 0 };
  assert.equal(sumComponents(full), 100); // not 85/100
});

test("scores are clamped to component points", () => {
  const components = Object.fromEntries(GRADE_COMPONENTS.map((k) => [k, { score: 999 }]));
  assert.equal(sumComponents(components), 100);
});

test("grade level shifts the score and the letter follows; arithmetic is traceable", () => {
  const g12 = applyGradeLevel(80, 12);
  assert.equal(g12.credit, 0);
  assert.equal(g12.total, 80);
  // Shipped arithmetic: 4 points of credit per grade below 12.
  const g8 = applyGradeLevel(80, 8);
  assert.equal(g8.credit, 16);
  assert.equal(g8.total, 96);
  assert.equal(g8.letter, letterFor(96));
  // The owner's example: an A+ for a third-grader is a D for a senior.
  assert.equal(applyGradeLevel(61, 3).total, 97);
  assert.equal(letterFor(applyGradeLevel(61, 3).total), "A+");
  assert.equal(letterFor(61), "D-");
  assert.equal(applyGradeLevel(99, 3).total, 100); // capped
});

test("letter bands are the standard scale with thirds — A+ exists, D has thirds", () => {
  assert.equal(letterFor(100), "A+");
  assert.equal(letterFor(97), "A+");
  assert.equal(letterFor(96), "A");
  assert.equal(letterFor(93), "A");
  assert.equal(letterFor(90), "A-");
  assert.equal(letterFor(89), "B+");
  assert.equal(letterFor(80), "B-");
  assert.equal(letterFor(79), "C+");
  assert.equal(letterFor(70), "C-");
  assert.equal(letterFor(69), "D+");
  assert.equal(letterFor(63), "D");
  assert.equal(letterFor(60), "D-");
  assert.equal(letterFor(59), "F");
});

test("sumComponents rounds to an integer, like the shipped scoreFromComponents", () => {
  // thesis 13/20 with only thesis+conclusion present → 13+10 of 30 = 76.666…
  const partial = { thesis: { score: 13 }, conclusion: { score: 10 } };
  assert.equal(sumComponents(partial), 77);
  assert.ok(Number.isInteger(sumComponents(partial)));
});
