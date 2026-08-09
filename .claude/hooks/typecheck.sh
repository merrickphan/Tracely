#!/usr/bin/env bash
# Stop: typecheck once per turn, at the only moment the code is meant to cohere.
#
# Deliberately NOT PostToolUse. Firing after every .ts edit means firing in the
# middle of a refactor, when the code is legitimately and temporarily broken —
# producing a stream of errors that are all noise, which is how a guardrail
# becomes something you learn to scroll past. Once per turn is also far cheaper:
# `npm run typecheck` is two full tsc passes over the project.
set -uo pipefail

payload=$(cat)

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0

# Claude Code sets stop_hook_active when it is already responding to a Stop hook
# that blocked. Without honouring it, a genuinely unfixable type error would
# bounce between "stop" and "here are the errors" forever.
active=$(printf '%s' "$payload" | node -e "
  let s=''
  process.stdin.on('data', d => s += d).on('end', () => {
    try { process.stdout.write(JSON.parse(s).stop_hook_active ? '1' : '') } catch { /* fall through */ }
  })
" 2>/dev/null)
[ -n "$active" ] && exit 0

# Nothing to check if the turn touched no TypeScript. A question, a git command
# or a docs edit should stay silent rather than costing seconds.
changed=$(git status --porcelain -- '*.ts' '*.tsx' 2>/dev/null)
[ -z "$changed" ] && exit 0

if out=$(npm run typecheck 2>&1); then
  exit 0
fi

# Only the compiler's own lines — npm's wrapper output is noise here.
errors=$(printf '%s' "$out" | grep -E "error TS[0-9]+" | head -20)
[ -z "$errors" ] && errors=$(printf '%s' "$out" | tail -20)

printf 'Typecheck failed:\n\n%s\n\nFix these before finishing.\n' "$errors" >&2
exit 2
