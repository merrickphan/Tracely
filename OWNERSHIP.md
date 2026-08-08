# Who owns what

Three git worktrees share one `.git`, on branches `agent1-work`, `agent2-work`,
`agent3-work`. `npm run ship` merges all three into `main` in that order, then
builds and publishes.

That merge is the reason this file exists. Two agents editing one file produces
a conflict at release time — the worst possible moment — or, worse, a clean
merge that silently reverts someone's work. Ownership is by **file**, not by
topic, because only files conflict.

## agent1 — evidence and reasoning

Everything that decides *what is true and what backs it up*.

    src/main/services/search/**      providers, aggregator, scoring, routing
    src/main/services/ml/**          embeddings, stance, the worker
    src/main/services/ai/**          detection, critique, correction, prompts
    src/main/eval/**                 the harness
    eval/**                          essays, labels, measurement scripts
    scripts/evaluate.mjs
    scripts/eval-http.mjs
    scripts/fetch-models.mjs
    scripts/verify-packaged-ml.mjs

Also owns **how Tracer reasons** — what it is asked, what context it is given,
how its answers are grounded. That logic lives in `services/ai/`.

## agent2 — the interface

Everything the user looks at.

    src/renderer/**                  all four windows, components, styles
    src/renderer/src/styles/**
    scripts/preview-ui.mjs           the live UI preview harness

`src/renderer/src/TracerApp.tsx` is agent2's, like every other renderer file.
agent3 builds what Tracer can *do*; agent2 builds what it *looks like*.

Note the two preview scripts, which are different tools with confusingly
similar names:

    npm run preview      builds eval/preview.html from an eval report   (agent1)
    npm run preview:ui   boots the live Vite + Electron UI harness      (agent2)

## agent3 — features and platform

Everything that makes the app *do* things and connect to the outside world.

    src/main/ipc/**                  IPC handlers
    src/main/services/storage/**     database, repos, migrations, Supabase
    src/main/services/screenWatch/** capture and monitoring
    src/preload/**
    scripts/ship*.mjs                release and preview-release pipelines
    scripts/preflight.mjs
    electron-builder.yml             packaging
    billing / Stripe                 when it exists

Exception inside agent3's territory: the ML packaging rules in
`electron-builder.yml` (the `@huggingface`/`onnxruntime` globs, `asarUnpack` of
`out/main/mlWorker.js`, `extraResources` of `resources/models`, and the
`afterPack` hook) are agent1's. They are load-bearing in a way that is invisible
when broken — v0.3.76 shipped with the whole ML stack excluded, degraded
silently to word-overlap ranking, and nothing errored. `npm run dist:win` runs
`scripts/verify-packaged-ml.mjs` and will fail the build rather than let that
happen again.

## Shared files — additive only

These are touched by everyone and cannot be assigned:

    src/shared/types.ts
    src/shared/ipc-contract.ts
    src/shared/ipc-channels.ts
    package.json
    electron.vite.config.ts

Rule: **add, never restructure.** Appending a field, a channel, or a dependency
merges cleanly. Reordering, reformatting, or rewriting a block conflicts with
everyone at once.

`package.json`'s `version` line belongs to `npm run ship` alone. Never edit it
by hand — electron-updater refuses downgrades, so a version that goes backwards
silently stops every installed app from updating, with no error anywhere.

## Before starting work

    git merge main

Not optional. On 2026-08-08 all three branches sat 24 commits behind main with
uncommitted work on top, which would have meant agent2 editing an
`EvidenceCard.tsx` that no longer existed in that form.

## When two agents genuinely need the same file

Sequence rather than merge. Land the functional change first, then the visual
one on top — restyling a working component is easy, re-adding behaviour to a
restyled one is not.
