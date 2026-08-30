/**
 * The Stripe webhook's two load-bearing decisions: is this delivery genuine,
 * and what does it actually say about the account.
 *
 * Signature tests build real signatures with node:crypto rather than fixtures,
 * so a change to what gets signed ("${t}.${rawBody}") fails here instead of in
 * production — where it fails silently, as "webhooks just never arrive".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyStripeSignature,
  planForPrice,
  planForSubscription,
  planChangeForEvent,
  supabaseUserIdFrom,
  SIGNATURE_TOLERANCE_MS,
} from "../lib/billing.js";

const SECRET = "whsec_test_secret";
const NOW = 1_756_500_000_000; // fixed clock; the tolerance window is relative
const ENV = { STRIPE_PRICE_STUDENT: "price_student_123", STRIPE_PRICE_PRO: "price_pro_456" };

function sign(rawBody, { secret = SECRET, at = NOW } = {}) {
  const t = Math.floor(at / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

const BODY = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });

test("verifyStripeSignature: a genuine signature over the raw body passes", () => {
  assert.deepEqual(verifyStripeSignature(BODY, sign(BODY), SECRET, { now: NOW }), { ok: true });
});

test("verifyStripeSignature: a re-serialized body does NOT match", () => {
  // The whole reason the route reads the raw body first. JSON round-tripping
  // changes bytes Stripe signed, and the failure is total and silent.
  const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
  assert.equal(verifyStripeSignature(reserialized, sign(BODY), SECRET, { now: NOW }).ok, false);
});

test("verifyStripeSignature: a single flipped byte fails", () => {
  const header = sign(BODY);
  const tampered = header.slice(0, -1) + (header.endsWith("a") ? "b" : "a");
  assert.equal(verifyStripeSignature(BODY, tampered, SECRET, { now: NOW }).ok, false);
});

test("verifyStripeSignature: the wrong secret fails", () => {
  assert.equal(verifyStripeSignature(BODY, sign(BODY, { secret: "whsec_other" }), SECRET, { now: NOW }).ok, false);
});

test("verifyStripeSignature: timestamps outside five minutes are stale, inside are fine", () => {
  const old = sign(BODY, { at: NOW - SIGNATURE_TOLERANCE_MS - 2_000 });
  assert.deepEqual(verifyStripeSignature(BODY, old, SECRET, { now: NOW }), { ok: false, reason: "stale" });

  const recent = sign(BODY, { at: NOW - SIGNATURE_TOLERANCE_MS + 60_000 });
  assert.equal(verifyStripeSignature(BODY, recent, SECRET, { now: NOW }).ok, true);
});

test("verifyStripeSignature: a future timestamp beyond tolerance is stale too", () => {
  // Clock skew cuts both ways; a signature dated next week is not fresh.
  const future = sign(BODY, { at: NOW + SIGNATURE_TOLERANCE_MS + 2_000 });
  assert.equal(verifyStripeSignature(BODY, future, SECRET, { now: NOW }).ok, false);
});

test("verifyStripeSignature: t is read as SECONDS", () => {
  // Signing with a millisecond t must be rejected — if the verifier also read
  // milliseconds this would pass, and every real Stripe event would fail.
  const t = NOW; // milliseconds, wrongly
  const v1 = createHmac("sha256", SECRET).update(`${t}.${BODY}`, "utf8").digest("hex");
  assert.equal(verifyStripeSignature(BODY, `t=${t},v1=${v1}`, SECRET, { now: NOW }).ok, false);
});

test("verifyStripeSignature: more than one v1 (secret rotation) passes if any matches", () => {
  const t = Math.floor(NOW / 1000);
  const good = createHmac("sha256", SECRET).update(`${t}.${BODY}`, "utf8").digest("hex");
  assert.equal(verifyStripeSignature(BODY, `t=${t},v1=deadbeef,v1=${good}`, SECRET, { now: NOW }).ok, true);
});

test("verifyStripeSignature: malformed headers and a missing secret fail closed", () => {
  assert.equal(verifyStripeSignature(BODY, "", SECRET, { now: NOW }).reason, "malformed");
  assert.equal(verifyStripeSignature(BODY, "v1=abc", SECRET, { now: NOW }).reason, "malformed");
  assert.equal(verifyStripeSignature(BODY, "t=notanumber,v1=abc", SECRET, { now: NOW }).reason, "malformed");
  assert.equal(verifyStripeSignature(BODY, sign(BODY), "", { now: NOW }).reason, "no_secret");
  assert.equal(verifyStripeSignature(null, sign(BODY), SECRET, { now: NOW }).ok, false);
});

test("verifyStripeSignature: a v1 of the wrong length is rejected, not thrown", () => {
  // timingSafeEqual throws on a length mismatch; that must be a decision here.
  const t = Math.floor(NOW / 1000);
  assert.equal(verifyStripeSignature(BODY, `t=${t},v1=abcd`, SECRET, { now: NOW }).ok, false);
  assert.equal(verifyStripeSignature(BODY, `t=${t},v1=zzzz`, SECRET, { now: NOW }).ok, false); // not hex
});

test("planForPrice: our two price ids map, and nothing else does", () => {
  assert.equal(planForPrice("price_student_123", ENV), "student");
  assert.equal(planForPrice("price_pro_456", ENV), "pro");
  assert.equal(planForPrice("price_someone_elses", ENV), null);
  assert.equal(planForPrice("", ENV), null);
  assert.equal(planForPrice(undefined, ENV), null);
});

test("planForPrice: an UNSET env var never matches", () => {
  // The trap: `priceId === env.STRIPE_PRICE_PRO` with both undefined would
  // hand Pro to every event that carried no price at all.
  assert.equal(planForPrice(undefined, {}), null);
  assert.equal(planForPrice("", {}), null);
  assert.equal(planForPrice("price_pro_456", {}), null);
});

test("planForSubscription: an active subscription resolves to its price's plan", () => {
  const sub = { status: "active", items: { data: [{ price: { id: "price_pro_456" } }] } };
  assert.equal(planForSubscription(sub, ENV), "pro");
  assert.equal(planForSubscription({ ...sub, status: "trialing" }, ENV), "pro");
  assert.equal(planForSubscription({ ...sub, status: "past_due" }, ENV), "pro");
});

test("planForSubscription: a subscription that stopped being active is free", () => {
  const sub = { status: "canceled", items: { data: [{ price: { id: "price_pro_456" } }] } };
  assert.equal(planForSubscription(sub, ENV), "free");
  assert.equal(planForSubscription({ ...sub, status: "unpaid" }, ENV), "free");
  assert.equal(planForSubscription({ ...sub, status: "incomplete_expired" }, ENV), "free");
});

test("planForSubscription: an active subscription on a price we do not know changes nothing", () => {
  // null, not free — an unset STRIPE_PRICE_PRO must not revoke paying accounts
  // the next time they renew.
  const sub = { status: "active", items: { data: [{ price: { id: "price_unknown" } }] } };
  assert.equal(planForSubscription(sub, ENV), null);
  assert.equal(planForSubscription({ status: "active", items: { data: [] } }, ENV), null);
});

test("supabaseUserIdFrom: client_reference_id first, then the metadata fallbacks", () => {
  assert.equal(supabaseUserIdFrom({ client_reference_id: "user-a", metadata: { user_id: "user-b" } }), "user-a");
  assert.equal(supabaseUserIdFrom({ metadata: { supabase_user_id: "user-b" } }), "user-b");
  assert.equal(supabaseUserIdFrom({ metadata: { user_id: " user-c " } }), "user-c");
  assert.equal(supabaseUserIdFrom({ client_reference_id: "  " , metadata: {} }), null);
  assert.equal(supabaseUserIdFrom({}), null);
  assert.equal(supabaseUserIdFrom(null), null);
});

test("planChangeForEvent: checkout carries the user id even when it carries no price", () => {
  const change = planChangeForEvent({
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "user-a", customer: "cus_1", customer_details: { email: "A@Example.com" } } },
  }, ENV);
  assert.equal(change.userId, "user-a");
  assert.equal(change.customerId, "cus_1");
  assert.equal(change.email, "a@example.com");
  assert.equal(change.plan, null); // the subscription event that follows sets it
});

test("planChangeForEvent: checkout with a price hint resolves a plan", () => {
  const change = planChangeForEvent({
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "user-a", metadata: { price_id: "price_student_123" } } },
  }, ENV);
  assert.equal(change.plan, "student");
});

test("planChangeForEvent: a checkout metadata plan hint cannot assert free", () => {
  // "free" as a hint means "nothing was bought"; treating it as a change would
  // let a junk metadata value revoke a plan.
  const change = planChangeForEvent({
    type: "checkout.session.completed",
    data: { object: { metadata: { plan: "free" } } },
  }, ENV);
  assert.equal(change.plan, null);
  assert.equal(planChangeForEvent({ type: "checkout.session.completed", data: { object: { metadata: { plan: "PRO" } } } }, ENV).plan, "pro");
});

test("planChangeForEvent: a deleted subscription is always a downgrade to free", () => {
  const change = planChangeForEvent({
    type: "customer.subscription.deleted",
    data: { object: { customer: "cus_1", items: { data: [{ price: { id: "price_pro_456" } }] } } },
  }, ENV);
  assert.equal(change.plan, "free");
  assert.equal(change.customerId, "cus_1");
});

test("planChangeForEvent: an updated subscription reads its status and price", () => {
  const change = planChangeForEvent({
    type: "customer.subscription.updated",
    data: { object: { customer: { id: "cus_2" }, status: "active", items: { data: [{ price: { id: "price_student_123" } }] } } },
  }, ENV);
  assert.equal(change.plan, "student");
  assert.equal(change.customerId, "cus_2"); // expanded customer object, not just an id
});

test("planChangeForEvent: event types we do not act on return null", () => {
  assert.equal(planChangeForEvent({ type: "invoice.paid", data: { object: {} } }, ENV), null);
  assert.equal(planChangeForEvent({ type: "customer.subscription.updated" }, ENV), null);
  assert.equal(planChangeForEvent(null, ENV), null);
  assert.equal(planChangeForEvent({}, ENV), null);
});
