---
description: Build and publish a staging build to the preview channel (was /preview)
---

Publish a preview build. It installs **alongside** stable rather than upgrading
over it, keeps its own database under `%APPDATA%\Tracely Preview`, and publishes
to `preview.yml` — so production installs poll `latest.yml` and never see it.

The channel is `preview`, not `beta`, and that is deliberate: electron-updater
ranks `alpha`/`beta` as channels of one app and will offer a beta client any
newer stable release. Preview is a separate application, so that hands reviewers
the production installer. See the header of `scripts/ship-preview.mjs`.

## What makes this safe to try things in

A preview build talks to **staging**, not production:

| | Preview build | Stable build |
|---|---|---|
| Relay | `tracely-relay-staging.vercel.app` | `folio-relay.vercel.app` |
| Supabase | staging project | production project |
| Accounts | separate — sign up again | real users |
| OpenAI | separate key, $5 hard cap | real key |

That separation is the entire point. A migration, a quota change or a broken
endpoint costs a throwaway database and pocket change instead of reaching users.

## Before

1. Be on a `feat/*` branch. `ship-preview.mjs` refuses to run on `main` —
   previews exist to review work *before* it lands.
2. `.env.staging` must exist. `env.mjs` refuses rather than falling back to
   `.env`, because a "preview" pointed at production is worse than no preview.
3. If the relay changed, push to the `staging` branch first and let it deploy.
   The client and the relay ship together in staging exactly as they do in
   production.

## Publish

```bash
cd C:\Users\merri\Tracely-agent1 && npm run ship:preview
```

`ship-preview.mjs` pins `TRACELY_ENV=staging` in the environment it spawns, so
this does not depend on anything being set in your shell — which would not work
through `cmd.exe` on Windows anyway.

## Watch for

**`env=staging file=.env.staging relay=tracely-relay-staging...`** in the build
log. If that line says `production`, stop — you are about to publish a preview
wired to real users and real money.

## After

Install it and sign in. Staging is a different Supabase project, so your
production account does not exist there; create one. That is working as intended,
not a bug.

The eval deliberately refuses to run against staging. Its numbers are only
comparable across runs if the backend behind them never moves.

## Not a release

A preview build never auto-updates into production — different `appId`, different
channel. Promoting means merging to `main` and running `/ship`, which rebuilds
against production.
