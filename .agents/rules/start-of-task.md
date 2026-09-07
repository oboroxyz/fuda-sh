# Start-of-Task Procedure

Applies to every request that changes files in this repository. `AGENTS.md`
imports it, and `.agents/hooks/session-start.sh` re-injects it at session start.
It overrides the harness default of branching before a commit.

1. Triage read-only. Decide which workflow applies before the first edit,
   branch, or worktree.
2. Read the `using-superpowers` skill unless the request is a fully specified,
   local, reversible edit, then follow its applicability rules. Skipping the
   skill unread is not a workflow decision.
3. Work in the current checkout on the current branch. Git commands and
   harness-specific tools that create or enter another branch or worktree are
   for a session where the user asked for isolation. When a commit would land
   on the default branch, ask before branching.
4. Follow `.agents/rules/superpowers-policy.md` for artifact locations, workflow
   selection, and the verification cadence.
