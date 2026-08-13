---
description: Run the app locally against staging, so testing costs nothing real
---

Launch Tracely from source, pointed at the staging backend.

```bash
$env:TRACELY_ENV="staging"; npm run dev
```

Hot-reloads as files change. Nothing is packaged, nothing is published, and the
auto-updater is inert — `initAutoUpdater` returns early when `app.isPackaged` is
false.

## Why staging rather than plain `npm run dev`

`.env` holds **production** values, so a bare `npm run dev` spends the real
OpenAI key and counts against real quota on every Analyze, every Screen Watch
detection, every critique. Fine for looking at a button. Not fine for
running detection twenty times while tuning something.

`TRACELY_ENV=staging` reads `.env.staging` instead: separate Supabase project,
separate OpenAI key with a low hard cap, throwaway data.

The variable lasts only for that terminal session. A new terminal is back to
production, which is the right default for a maintainer — but check the banner
rather than assuming.

## Confirm which backend you got

Every build prints it. This is the only way to know:

```
env=staging  file=.env.staging  relay=tracely-relay-staging.vercel.app  supabase=sxifbtelrtbsgnnwnmdf
```

`relay=` is the line that matters. If it says `folio-relay`, the variable did not
take and you are on production.

## You will need the staging account

Staging is a different Supabase project, so your production login does not exist
there. Sign up separately, once. That is working as intended, not a bug.

## When this is not enough

`npm run dev` resolves modules from `node_modules`, so it cannot see anything
that only breaks once packaged — the ML worker loading out of `app.asar`, the
installer, auto-update. v0.3.76 shipped with the entire ML stack excluded and
dev was completely happy.

For those, build a real installer with `/beta`. (`/preview` is the UI harness —
real renderer, mocked everything else — which cannot see packaging problems
either.)
