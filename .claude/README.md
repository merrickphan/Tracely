# `.claude/` — how the guardrails work

Checked in on purpose. These are project rules, not personal preferences, and
they should be the same for anyone (or any agent) working on Tracely.
Machine-specific settings go in `settings.local.json`, which is gitignored.

## Why secrets are a permission rule, not a hook

`settings.json` denies reads and writes of `.env`, `.env.staging`, `.env.release`
and the killswitch backup through `permissions.deny` rather than through a hook.

A hook has to *run* to protect you. If bash is missing, or the file picked up
CRLF line endings, or there's a typo on line 3, the hook exits non-zero — and a
non-zero exit that isn't exactly `2` is treated as a hook *error*, which means
the tool call proceeds anyway. So a broken secret-guard hook looks identical to
a working one right up until it lets something through. A permission rule is
declarative and cannot fail open.

The paths are enumerated rather than globbed as `.env*`, because that glob would
also block `.env.example`, which is documentation and should stay readable.

**Consequence:** `.env.staging` has to be created by hand. That is intended.

## The hooks

| File | Fires on | Does |
|---|---|---|
| `guard-bash.sh` | before any `Bash` | Blocks `git commit`/`merge`/`push` on `main`. Asks before anything that spends money or publishes. |
| `guard-edit.sh` | before any `Edit`/`Write` | Blocks edits to `src/`, `scripts/`, `package.json` and build config while on `main`. |
| `typecheck.sh` | end of turn | Runs `npm run typecheck` if the turn touched TypeScript. |
| `autocommit.sh` | end of turn | Commits and pushes the turn's work to the current branch. Refuses on `main`. |

### Rules any new hook here must follow

**Only ever exit 0 or 2.** Exit 2 blocks and shows stderr to Claude; exit 0
allows. Every other non-zero exit is a hook error and the tool runs regardless,
so `exit 1` on a scripting slip means the guard silently stops guarding.

**No `jq`.** Git Bash on Windows doesn't have it. Parse the stdin payload with
`node`, which this project already depends on. Don't use bash string slicing
like `${x#*\"command\":\"}` — it truncates on the first escaped quote, so it
fails on exactly the unusual commands worth inspecting.

**Test that it actually blocks.** Feed it a payload and check the exit code. Two
real bugs were caught this way: a `${path//\\//}` substitution that silently
didn't normalise Windows separators, so the edit guard allowed every backslash
path; and a test whose own JSON was malformed, which made a working guard look
broken. A hook nobody has watched block is not a guardrail.

**Line endings.** `.gitattributes` pins `*.sh` to LF. Without it, `core.autocrlf`
hands bash a trailing `\r` and the script dies before its first check.

## Why `guard-edit.sh` exists when `guard-bash.sh` already blocks commits

Blocking `git commit` stops the *record* of the mistake, not the mistake.
`electron-builder` packages the working tree rather than `HEAD`, so an
uncommitted edit sitting on `main` can reach an installer without ever being
committed. The edit guard is the real protection; the commit rule is a backstop.

`npm run ship` is unaffected: it runs git inside `execSync`, so the hook only
ever sees the single `npm run ship` invocation, not the commands underneath it.
