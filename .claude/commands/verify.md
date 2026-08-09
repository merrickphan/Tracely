---
description: Free end-to-end health check of the relay, auth, quota and RLS
---

Check that Tracely's backend is actually working. **This costs nothing** — every
probe stops before reaching OpenAI — so it is safe to run against production any
time.

Run these and report what you find. Do not assume a result; a check that was
skipped is not a check that passed.

## 1. Which host is production

`RELAY_URL` in `.env` is compiled into every installer, so pointing a release at
the wrong host breaks every copy of the app.

An unauthenticated probe returns `401` from *any* host that exists, including the
wrong one — so it cannot tell them apart. Send the real shared token and compare
the message:

- `Sign in to use Tracely.` → token accepted, relay healthy
- `Unauthorized` → token rejected, **this is not production**

Read `RELAY_TOKEN` out of `.env` without printing it.

## 2. Every endpoint is live

`node scripts/preflight.mjs` covers this, or probe each endpoint in `callRelay`'s
type union directly. A `404` means the relay was not deployed with the client —
the failure that shipped in v0.3.73.

## 3. The migration actually ran

This is the one that hides. `checkRateLimit` fails **open** on error, so against
a database with no `relay_quota()` every quota check silently passes and there is
no rate limiting at all — indistinguishable from working, from the outside.

With the anon key from `.env`, against `SUPABASE_URL`:

- `POST /rest/v1/rpc/relay_quota` with a zero uuid → must return a row, not a
  "could not find the function" error
- `GET /rest/v1/user_entitlements?limit=1` → must not 404

## 4. RLS is closed

The anon key ships inside every installer, so treat it as public and test what a
stranger could do with it:

- `GET /rest/v1/usage_log?limit=1` → must be empty
- `POST /rest/v1/usage_log` with a dummy row → must fail with `42501 new row
  violates row-level security policy`

If that insert succeeds, anyone with the app can inflate `burst_global` past its
ceiling and lock out every real user. That is the highest-severity thing this
command checks.

**Do not** test DELETE with a filter that matches everything. If RLS were not
applied, that command would erase the usage log rather than report a problem.

## Report

State each check as pass or fail with the evidence, and say plainly which checks
you could not perform and why. "Probably fine" is not a result.
