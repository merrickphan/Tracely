---
name: relay
description: Backend work on the Tracely relay — endpoints, auth, quota, entitlements, Supabase schema. Use when the change is in C:\Users\merri\Tracely-relay rather than the desktop app.
---

You work on the Tracely relay at `C:\Users\merri\Tracely-relay` — a Vercel
serverless project holding the OpenAI key the desktop app must never have.

## The shape every endpoint follows

```
isAuthorized(req)      -> is this a Tracely build?   401
resolveUser(req)       -> which account?             401/503   FAILS CLOSED
checkRateLimit(userId) -> within budget?             429       fails OPEN
body parse (zod)       -> 400
reserveUsage(...)      -> claim the slot BEFORE the model runs
  ... OpenAI ...
settleUsage(id, ok)
```

Keep that order. Each step is cheaper than the one after it, and identity is
resolved before anything can spend.

## The reasoning you must not undo

**`resolveUser` fails closed, `checkRateLimit` fails open.** An unattributable
call is exactly the one that must not spend money. A database hiccup, by
contrast, should not take the relay down — and that is only acceptable *because*
auth already refused anyone it could not identify.

**Usage is reserved before the model call, not logged after.** Logging afterwards
made the quota advisory: N concurrent requests all read the same count, all pass,
all spend. Reserving first shrinks that window from the length of an OpenAI call
to the length of an insert.

**A missing `user_entitlements` row means free tier.** Signing up provisions
nothing, and an unrecognised plan string falls back to free rather than being
trusted — a billing bug should cap someone low, not silently grant the most
expensive tier.

**There is no global daily cap, deliberately.** It would let one abuser lock out
every real user, turning a spend problem into an outage.

## Environments

`staging` branch → `tracely-relay-staging`. `main` → `tracely-relay`, whose URL
is `folio-relay.vercel.app` (legacy alias — *not* `tracely-relay.vercel.app`,
which resolves but lacks production's variables).

Work lands on `staging` first. Production advances only by
`git merge --ff-only staging`.

**`supabase.sql` is not run by anything.** If you change it, it must be applied
by hand to both Supabase projects, staging first — and *before* the code that
depends on it deploys, or `checkRateLimit` fails open with nothing indicating it.

## Verifying

An unauthenticated probe returns 401 from any host that exists, so it cannot tell
a healthy relay from the wrong one. Send the real shared token: production
answers `Sign in to use Tracely.`, anything else answers `Unauthorized`.

`scripts/verify-auth.mjs <url>` costs nothing — it uses a deliberately invalid
body, so nothing reaches the model.

Always `npx tsc --noEmit` before pushing. Vercel does not reliably fail a deploy
on type errors, so a type-broken relay can reach production.
