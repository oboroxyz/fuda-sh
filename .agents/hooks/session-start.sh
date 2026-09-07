#!/usr/bin/env bash
# SessionStart hook: injects .agents/rules/start-of-task.md and the
# `using-superpowers` skill body, so workflow selection happens before the first
# edit rather than being left to the agent's judgement mid-task.
#
# The superpowers plugin ships an equivalent hook, but it is disabled in favour
# of the locally customised skills in ~/.claude/skills. This script is the
# repository-owned replacement. It never fails the session: a missing skill file
# degrades to the procedure alone.

set -euo pipefail

skill_path="${FUDA_SUPERPOWERS_SKILL:-${HOME}/.claude/skills/using-superpowers/SKILL.md}"
skill=""
if [ -f "$skill_path" ]; then
  skill="$(cat "$skill_path")"
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
procedure="$(cat "${repo_root}/.agents/rules/start-of-task.md")"

if [ -n "$skill" ]; then
  context="<EXTREMELY_IMPORTANT>
${procedure}

The full body of the \`using-superpowers\` skill follows. Use the \`Skill\` tool
for every other skill.

${skill}
</EXTREMELY_IMPORTANT>"
else
  context="<EXTREMELY_IMPORTANT>
${procedure}

The \`using-superpowers\` skill was not found at ${skill_path}. Say so when a
task would have used it, rather than silently proceeding without it.
</EXTREMELY_IMPORTANT>"
fi

jq -n --arg ctx "$context" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
