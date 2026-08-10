# AGENTS.md

Instructions for coding agents working in this repository — Codex, Claude Code,
or anything else.

**Read [CLAUDE.md](CLAUDE.md) first** — the source of truth for what this
project is, how it is built, and why the odd parts are the way they are — and
**[CONTRIBUTING.md](CONTRIBUTING.md)** for setup and the review process. Neither
is repeated here. Only `AGENTS.md` is loaded automatically, so those two are
linked rather than copied: three files saying the same thing is three files that
disagree within a month.

What follows are the rules Claude Code enforces automatically through hooks in
`.claude/`, and that **every other agent must follow by hand**, because those
hooks do not run for you.

## Working a task

This is the standing loop. It does not need restating in a prompt — assume it
unless you are told otherwise.

1. **Read the linked issue first.** It carries the constraints, and it is what
   the change gets reviewed against. If a task arrives without one, ask what
   "done" means before writing code.
2. **Branch off an up-to-date `main`**, named `feat/<short-description>` (or
   `fix/`, `docs/`). Never work on `main` itself.
3. **Stay inside the scope the issue names.** Finishing early is not a reason to
   add adjacent improvements; it makes a small reviewable change into a large
   unreviewable one. Raise the idea instead.
4. **Run `npm run typecheck` before committing.** It is the only automated
   correctness check here.
5. **Push the branch and hand back the pull request link.** `git push` prints one.
6. **Never merge, and never release.** A human decides both.

Prompts should carry only what cannot be read from the repository — product
judgment, scope, and where to stop. Which file to imitate and how to write the
code are things you can work out faster by reading than by being told.

## Never do these

**Never read, edit, or commit any `.env*` file** except `.env.example`. They hold
the OpenAI-adjacent relay token, Supabase keys, and a GitHub release token.
**This repository is public.** A secret committed here is a secret published to
the internet, and rewriting history does not unpublish it.

**Never commit directly to `main`.** Branch, open a pull request. `main` is the
only branch releases are cut from, and it advances by reviewed merge.

**Never edit the `version` field in `package.json`.** It belongs to
`scripts/ship.mjs` alone. Editing it by hand desynchronises the published
release channel from the repository.

**Never run the eval without asking first.** `npm run evaluate` makes paid
OpenAI calls and spends OpenAlex credits. Say what a run will cost before
proposing it. `EVAL_SKIP_CRITIQUE=1` is *not* free — detection is unconditional
and also paid.

**Never publish a release.** `npm run ship` and `npm run ship:preview` are the
maintainer's, and require a `GH_TOKEN` you do not have.

## Always do these

**Run `npm run typecheck` before pushing.** It is the only automated correctness
check this project has. There is no test suite yet.

**Commit before building.** `electron-builder` packages the *working tree*, not
`HEAD`, so an uncommitted edit can end up inside an installer while being absent
from the commit it was supposedly built from.

**Keep branches short-lived.** Open a PR within a day or two. Long-lived
branches are the single largest source of pain in this repo's history: a
six-hunk conflict in `TracerApp.tsx` came from `main` rebuilding a component on
Tailwind while a branch kept editing the pre-Tailwind version, and 421 lines
once sat uncommitted in stale worktrees.

## Which environment your build talks to

`RELAY_URL`, `RELAY_TOKEN`, `SUPABASE_URL` and `SUPABASE_ANON_KEY` are compiled
into the bundle at build time by `electron.vite.config.ts`. There is **no runtime
override** — no setting, no config file. The only way to see which backend a
build uses is the banner every build prints:

```
env=staging  file=.env.staging  relay=tracely-relay-staging.vercel.app  supabase=sxifbtelrtbsgnnwnmdf
```

If you are not the maintainer, your `.env` holds **staging** values, so
everything you build points at the staging backend. That is deliberate: staging
has its own database, its own OpenAI key and a low spend cap, so nothing you do
can reach a real user or a real bill. If that banner ever says `production` on
your machine, stop and ask.

## The relay is a separate repository

Backend work — endpoints, auth, quota, Supabase schema — lives in
`Tracely-relay`, not here. It deploys by pushing a branch: `staging` deploys the
staging relay, `main` deploys production. There is no deploy command.

Always run `npx tsc --noEmit` before pushing the relay. Vercel does not reliably
fail a deploy on type errors, so a type-broken relay can reach production.

## The two rules that exist because something broke

**Do not add a blanket exclusion to `files` in `electron-builder.yml`** without
checking what actually imports the thing you are excluding. v0.3.76 shipped with
the entire ML stack excluded; the app degraded to word-overlap ranking exactly as
designed — silently, with no error — while every measurement described a code
path no user was running.

**Do not change the order of checks in a relay endpoint.** It is
`isAuthorized → resolveUser → checkRateLimit → parse → reserveUsage → OpenAI`.
Each step is cheaper than the one after it, and identity is resolved before
anything can spend. `resolveUser` fails **closed** and `checkRateLimit` fails
**open**, and that asymmetry is deliberate.
