/**
 * The entitlement vocabulary: plan precedence, model clamping, and the day
 * boundary the free tier's quota resets on.
 *
 * Every one of these pins a way the system could quietly hand out something
 * nobody paid for — a user-writable metadata field overriding a server-set
 * plan, a stale prefs row asking for Opus, a quota that never resets or resets
 * mid-session. shared/plan.js is a leaf, so these load without a database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLAN,
  PLANS,
  normalizePlan,
  planFromMetadata,
  clampModel,
  ceilingModelFor,
  MODEL_FOR_TIER,
  dailySourceSearchLimit,
  withinDailyLimit,
  usageDay,
  FREE_DAILY_SOURCE_SEARCHES,
} from "../shared/plan.js";

const HAIKU = MODEL_FOR_TIER.fast;
const SONNET = MODEL_FOR_TIER.balanced;
const OPUS = MODEL_FOR_TIER.thorough;

test("normalizePlan: anything unrecognised is free", () => {
  assert.equal(normalizePlan("pro"), "pro");
  assert.equal(normalizePlan("  Student "), "student"); // written by checkout, not by us
  assert.equal(normalizePlan("enterprise"), DEFAULT_PLAN);
  assert.equal(normalizePlan(undefined), DEFAULT_PLAN);
  assert.equal(normalizePlan(null), DEFAULT_PLAN);
  assert.equal(normalizePlan(7), DEFAULT_PLAN);
  assert.equal(normalizePlan({ plan: "pro" }), DEFAULT_PLAN);
});

test("planFromMetadata: the plan comes from app_metadata", () => {
  assert.equal(planFromMetadata({ plan: "free" }), "free");
  assert.equal(planFromMetadata({ plan: "student" }), "student");
  assert.equal(planFromMetadata({ plan: "pro" }), "pro");
  assert.equal(planFromMetadata({ plan: "  Pro " }), "pro");
});

test("planFromMetadata: user_metadata is NEVER a plan source — it is self-writable", () => {
  // The whole attack: a signed-in user can PUT /auth/v1/user with
  // {"data":{"plan":"pro"}} using their own access token, which lands in
  // user_metadata. Reading it "only when app_metadata is silent" is not safe:
  // an account that never paid has no app_metadata.plan at all, so the
  // fallback would be consulted for precisely the users who have not paid.
  // planFromMetadata takes ONE argument now, so a caller cannot pass it.
  assert.equal(planFromMetadata.length, 1);
  const attacker = { id: "u", app_metadata: {}, user_metadata: { plan: "pro" } };
  assert.equal(planFromMetadata(attacker.app_metadata), DEFAULT_PLAN);
  assert.equal(planFromMetadata(undefined), DEFAULT_PLAN); // no app_metadata key at all
  assert.equal(planFromMetadata(null), DEFAULT_PLAN);
  assert.equal(planFromMetadata({ provider: "google", providers: ["google"] }), DEFAULT_PLAN);
});

test("planFromMetadata: a junk or null app_metadata plan is free, never a fall-through", () => {
  assert.equal(planFromMetadata({ plan: "enterprise" }), DEFAULT_PLAN);
  assert.equal(planFromMetadata({ plan: 42 }), DEFAULT_PLAN);
  assert.equal(planFromMetadata({ plan: null }), DEFAULT_PLAN);
});

test("planFromMetadata: no metadata at all is free", () => {
  assert.equal(planFromMetadata(undefined), DEFAULT_PLAN);
  assert.equal(planFromMetadata({}), DEFAULT_PLAN);
  assert.equal(planFromMetadata("pro"), DEFAULT_PLAN); // strings are not metadata
});

test("clampModel: a plan never reaches above its ceiling", () => {
  assert.equal(clampModel(OPUS, "free"), HAIKU);
  assert.equal(clampModel(SONNET, "free"), HAIKU);
  assert.equal(clampModel(OPUS, "student"), SONNET);
  assert.equal(clampModel(OPUS, "pro"), OPUS);
});

test("clampModel: a request below the ceiling is honoured, never upgraded", () => {
  assert.equal(clampModel(HAIKU, "pro"), HAIKU);
  assert.equal(clampModel(SONNET, "pro"), SONNET);
  assert.equal(clampModel(HAIKU, "student"), HAIKU);
});

test("clampModel: an unknown or absent request resolves DOWN to the fast model", () => {
  // Resolving up would turn "the client sent nothing" into an Opus bill, and
  // the pre-entitlement default on every route was already the cheap model.
  assert.equal(clampModel(undefined, "pro"), HAIKU);
  assert.equal(clampModel("", "pro"), HAIKU);
  assert.equal(clampModel("claude-3-opus-20240229", "pro"), HAIKU);
  assert.equal(clampModel({ model: OPUS }, "pro"), HAIKU);
});

test("clampModel: an unknown plan is treated as free", () => {
  assert.equal(clampModel(OPUS, "enterprise"), HAIKU);
  assert.equal(clampModel(OPUS, undefined), HAIKU);
  assert.equal(ceilingModelFor("enterprise"), HAIKU);
});

test("clampModel: every plan's ceiling model is one the clamp round-trips", () => {
  // A ceiling naming a model the map does not know would clamp to fast and
  // silently sell nothing — catch that here rather than in a bill.
  for (const plan of PLANS) {
    const ceiling = ceilingModelFor(plan);
    assert.equal(clampModel(ceiling, plan), ceiling, plan);
  }
});

test("dailySourceSearchLimit: only free is metered", () => {
  assert.equal(dailySourceSearchLimit("free"), FREE_DAILY_SOURCE_SEARCHES);
  assert.equal(dailySourceSearchLimit("student"), null);
  assert.equal(dailySourceSearchLimit("pro"), null);
  assert.equal(dailySourceSearchLimit("nonsense"), FREE_DAILY_SOURCE_SEARCHES); // unknown ⇒ free ⇒ metered
});

test("withinDailyLimit: the limit is a ceiling on the count taken BEFORE the call", () => {
  assert.equal(withinDailyLimit(0, 5), true);
  assert.equal(withinDailyLimit(4, 5), true); // the fifth search is allowed
  assert.equal(withinDailyLimit(5, 5), false); // the sixth is not
  assert.equal(withinDailyLimit(99, null), true); // unmetered
});

test("usageDay: two moments in the same local day share a key", () => {
  const morning = new Date(2026, 7, 30, 0, 0, 0).getTime();
  const night = new Date(2026, 7, 30, 23, 59, 59).getTime();
  assert.equal(usageDay(morning), usageDay(night));
  assert.equal(usageDay(morning), "2026-08-30");
});

test("usageDay: midnight local starts a new day — the quota resets there", () => {
  const lastSecond = new Date(2026, 7, 30, 23, 59, 59).getTime();
  const firstSecond = new Date(2026, 7, 31, 0, 0, 0).getTime();
  assert.notEqual(usageDay(lastSecond), usageDay(firstSecond));
  assert.equal(usageDay(firstSecond), "2026-08-31");
});

test("usageDay: month and year boundaries pad and roll over", () => {
  assert.equal(usageDay(new Date(2026, 0, 1, 0, 0, 0).getTime()), "2026-01-01");
  assert.equal(usageDay(new Date(2025, 11, 31, 23, 0, 0).getTime()), "2025-12-31");
  assert.equal(usageDay(new Date(2026, 8, 9, 12, 0, 0).getTime()), "2026-09-09"); // zero-padded
});

test("usageDay: the boundary is LOCAL, not UTC", () => {
  // A UTC day key lands mid-evening for most US writers and would reset the
  // quota while they were still working. Constructed in local time, an 8pm
  // local moment must still belong to its own local date.
  const evening = new Date(2026, 7, 30, 20, 0, 0);
  assert.equal(usageDay(evening.getTime()), "2026-08-30");
});

test("day-boundary metering: five searches fill a day and the next day is empty", () => {
  // The counter itself is one row per (account, day); this models the decision
  // that row drives, which is the half that must not drift.
  const counts = new Map();
  const limit = dailySourceSearchLimit("free");
  const attempt = (at) => {
    const day = usageDay(at);
    const used = counts.get(day) ?? 0;
    if (!withinDailyLimit(used, limit)) return false;
    counts.set(day, used + 1);
    return true;
  };

  const today = new Date(2026, 7, 30, 9, 0, 0).getTime();
  for (let i = 0; i < FREE_DAILY_SOURCE_SEARCHES; i++) assert.equal(attempt(today), true, `search ${i + 1}`);
  assert.equal(attempt(new Date(2026, 7, 30, 23, 59, 0).getTime()), false); // still the same day

  const tomorrow = new Date(2026, 7, 31, 0, 0, 1).getTime();
  assert.equal(attempt(tomorrow), true);
  assert.equal(counts.get("2026-08-31"), 1);
  assert.equal(counts.get("2026-08-30"), FREE_DAILY_SOURCE_SEARCHES);
});
