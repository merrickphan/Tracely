#!/usr/bin/env bash
# PreToolUse(Bash): keep main clean, and make spending deliberate.
#
# Exit codes matter more than they look. Exit 2 blocks the call and shows
# stderr to Claude. Exit 0 allows it. EVERY OTHER non-zero exit — 1 from a
# scripting slip, 127 from a missing binary — is treated as a hook error and
# the tool runs anyway. So this script must only ever exit 0 or 2, and any
# internal failure must land on 0 rather than 1.
set -uo pipefail

payload=$(cat)

# Parsed with node rather than bash string surgery. Git Bash has no jq, and the
# usual ${x#*\"command\":\"} trick silently truncates any command containing an
# escaped quote — which would make this guard skip exactly the commands most
# likely to be doing something unusual.
field() {
  printf '%s' "$payload" | node -e "
    let s=''
    process.stdin.on('data', d => s += d).on('end', () => {
      try { process.stdout.write(String(JSON.parse(s).tool_input?.$1 ?? '')) } catch { /* allow */ }
    })
  " 2>/dev/null
}

cmd=$(field command)
[ -z "$cmd" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

deny() {
  printf '%s\n' "$1" >&2
  exit 2
}

# Hand-rolled JSON, same reason as above: no jq available.
ask() {
  local m=${1//\\/\\\\}
  m=${m//\"/\\\"}
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$m"
  exit 0
}

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  case "$cmd" in
    *"git commit"*|*"git merge"*|*"git push"*|*"git rebase"*)
      # npm run ship is exempt: it commits the version bump on main by design,
      # and it runs git inside execSync, so this hook never sees those calls —
      # it only sees the single `npm run ship` invocation.
      deny "On ${branch}. It advances only by a reviewed merge, so releases stay reproducible.

Work on a branch instead:
  git checkout -b feat/<what-you-are-doing>

To release what is already on main, run: npm run ship"
      ;;
  esac
fi

# Money and irreversibility. 'ask' rather than 'deny' — these are all things you
# legitimately want to run, just never by accident.
case "$cmd" in
  *EVAL_ALLOW_SPEND*|*EVAL_REFRESH*|*"npm run evaluate"*)
    ask "This runs the eval against the live relay: paid OpenAI calls plus OpenAlex credits (10 per claim, 1000/day free)." ;;
  *"run ship"*|*release:win*|*preview:win*)
    ask "This publishes a release. Installed copies pick it up within 6 hours and electron-updater cannot downgrade them." ;;
  *"vercel --prod"*|*"vercel deploy --prod"*|*"vercel promote"*)
    ask "This deploys the relay to production, which every installed build talks to." ;;
  *"git push --force"*|*"git push -f"*)
    ask "Force push. This rewrites history other checkouts may already have." ;;
esac

exit 0
