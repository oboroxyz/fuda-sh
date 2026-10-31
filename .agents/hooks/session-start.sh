#!/usr/bin/env bash
# SessionStart hook: injects .agents/rules/start-of-task.md, so triage happens
# before the first edit rather than being left to the agent's judgement
# mid-task.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
procedure="$(cat "${repo_root}/.agents/rules/start-of-task.md")"

context="<EXTREMELY_IMPORTANT>
${procedure}
</EXTREMELY_IMPORTANT>"

jq -n --arg ctx "$context" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
