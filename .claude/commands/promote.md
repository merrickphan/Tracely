---
description: Promote the relay from staging to production after verifying staging
---

Move the relay's `staging` branch into `main`, which is what deploys to
production and therefore to every installed copy of Tracely.

## Before promoting

Staging must have actually run the code. Promoting something nobody exercised is
just deploying to production with extra steps.

1. Confirm the staging deployment is `Ready` and is the newest on
   `tracely-relay-staging`.
2. Run `/verify` against the **staging** relay.
3. If `supabase.sql` changed, confirm it was applied to the staging Supabase
   project — and remember it must be applied to production too, *before* the
   code that depends on it goes live. A migration that lands after its code
   leaves a window where quota checks fail open.

## Promote

```bash
cd C:\Users\merri\Tracely-relay && git checkout main && git merge --ff-only staging && git push
```

`--ff-only` is the whole point. It refuses unless `main` can move forward to
exactly what `staging` has, which makes it structurally impossible for production
to contain a commit staging never ran. If it refuses, something landed on `main`
directly — investigate rather than reaching for a merge commit.

## After promoting

- Confirm `tracely-relay` built a **Production** deployment, not a Preview. A
  Preview means the production branch setting is wrong.
- Re-run `/verify` against production.
- Confirm `git rev-list --count main..staging` is `0` in both directions.

## Never

Do not "redeploy" production to fix something. If `main` is behind what
production is serving, a redeploy silently reverts to `main`'s code — which has
previously meant dropping per-user auth entirely, with nothing appearing broken.
Fast-forward `main` first, then deploy.
