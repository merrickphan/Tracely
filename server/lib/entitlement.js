/**
 * Who is calling, and what they are entitled to.
 *
 * The extension puts a Supabase access token in the Authorization header of
 * every relayed call; this module turns that header into a plan by asking
 * Supabase who the token belongs to, and reads the answer out of the user's
 * metadata with shared/plan.js's precedence rules (app_metadata first — it is
 * the half only the service role can write).
 *
 * **Nothing here throws and nothing here answers high.** Supabase down, a
 * revoked token, a body that isn't JSON, a 500 — every path lands on `free`,
 * because this sits in front of the endpoints the extension needs to keep
 * working. A user who cannot be identified is an anonymous user, and an
 * anonymous user is a free user; that is not an error condition.
 *
 * **With no SUPABASE_URL configured, entitlement is off entirely.** Not "off
 * meaning everyone is free" — off meaning nothing is clamped and nothing is
 * metered, so a local run with an empty .env behaves exactly as this server
 * did before any of this existed. That is what `enforced` carries.
 */
import { createHash } from "node:crypto";
import { usageCount, usageBump } from "./db.js";
import {
  DEFAULT_PLAN,
  planFromMetadata,
  usageDay,
  dailySourceSearchLimit,
  withinDailyLimit,
} from "../shared/plan.js";

// Every check call asks, and a browser extension re-asks on every keystroke
// burst, so the same token must not become a Supabase round trip each time.
// 60s is short enough that an upgrade takes effect while the user is still
// looking at the checkout tab.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

// A hung auth server must not hang a fact-check. Past this we answer free,
// which is the same answer we would give if the token were bad.
const SUPABASE_TIMEOUT_MS = 4_000;

const cache = new Map();

export function entitlementConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** The bearer token on a request, or null. Anything malformed is "no token". */
export function bearerToken(req) {
  const header = req?.headers?.authorization ?? "";
  const m = /^Bearer[ \t]+(\S+)$/.exec(header.trim());
  return m ? m[1] : null;
}

function anonymous() {
  return { plan: DEFAULT_PLAN, email: null, userId: null, enforced: entitlementConfigured() };
}

function cacheKey(token) {
  // The token never goes in a Map key we might log; its hash identifies it.
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolve a token against Supabase. Failures — including a token Supabase
 * rejects — are cached too: a stale token attached to a retry loop would
 * otherwise hammer /auth/v1/user once per keystroke burst.
 */
async function resolveToken(token) {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
  try {
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
    if (!res.ok) return anonymous();
    const user = await res.json();
    if (!user || typeof user !== "object" || !user.id) return anonymous();
    return {
      // app_metadata only — user_metadata is account-holder writable, see shared/plan.js.
      plan: planFromMetadata(user.app_metadata),
      email: typeof user.email === "string" ? user.email : null,
      userId: user.id,
      enforced: true,
    };
  } catch {
    return anonymous();
  }
}

/**
 * The entitlement for one request: `{ plan, email, userId, enforced }`.
 *
 * `userId` is what the meter counts against — null means "we do not know who
 * this is", which is how a local, signed-out run stays unmetered.
 */
export async function planForRequest(req) {
  if (!entitlementConfigured()) return anonymous();
  const token = bearerToken(req);
  if (!token) return anonymous();

  const key = cacheKey(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await resolveToken(token);
  if (cache.size >= CACHE_MAX) {
    // Cheap bound: the Map iterates in insertion order, so this drops oldest.
    for (const k of cache.keys()) {
      cache.delete(k);
      if (cache.size < CACHE_MAX) break;
    }
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Testing/reload seam — a plan changed by a webhook should not wait 60s. */
export function forgetCachedPlans() {
  cache.clear();
}

// ── free-tier metering ─────────────────────────────────────────────────
// Only IDENTIFIED free accounts are metered. Anonymous callers are counted by
// nothing, exactly as before entitlement existed, because the local server has
// no account to meter and Sam running it with no sign-in must be unaffected.

const SOURCE_SEARCH_KIND = "source_search";

/**
 * Where an account stands against its daily source-search quota.
 * `limit: null` means unmetered — a paid plan, an anonymous caller, or a
 * server with no Supabase configured.
 */
export function sourceSearchQuota(ent, at = Date.now()) {
  if (!ent?.enforced || !ent.userId) return { limit: null, used: 0, allowed: true, day: usageDay(at) };
  const limit = dailySourceSearchLimit(ent.plan);
  const day = usageDay(at);
  if (limit === null) return { limit: null, used: 0, allowed: true, day };
  const used = usageCount(ent.userId, day, SOURCE_SEARCH_KIND);
  return { limit, used, allowed: withinDailyLimit(used, limit), day };
}

/** Stamped BEFORE the search, like every other counter in this codebase. */
export function recordSourceSearch(ent, at = Date.now()) {
  if (!ent?.enforced || !ent.userId) return 0;
  if (dailySourceSearchLimit(ent.plan) === null) return 0;
  return usageBump(ent.userId, usageDay(at), SOURCE_SEARCH_KIND);
}
