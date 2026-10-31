# Start-of-Task Procedure

Applies to every request that changes files in this repository. `AGENTS.md` imports it, and `.agents/hooks/session-start.sh` re-injects it at session start. It overrides the harness default of branching before a commit.

1. Triage read-only. Decide whether the task needs design decisions before the first edit, branch, or worktree.
2. Work in the current checkout on the current branch. Git commands and harness-specific tools that create or enter another branch or worktree are for a session where the user asked for isolation. When a commit would land on the default branch, ask before branching.
3. Follow `.agents/rules/workflow-policy.md` for the documentation hierarchy, where decisions are recorded, and the verification cadence.
