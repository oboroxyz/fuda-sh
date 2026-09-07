# Start-of-Task Procedure

Applies to every request that changes files in this repository. `AGENTS.md`
imports it, and `.agents/hooks/session-start.sh` re-injects it at session start.
It overrides the harness default of branching before a commit.

1. Triage read-only. Decide which workflow applies before the first edit,
   branch, or worktree.
2. Apply `using-superpowers` unless the request is a fully specified, local,
   reversible edit. Invoke it with the `Skill` tool when its body is not already
   in context. The skill decides whether a Superpowers workflow applies;
   skipping it unread is not that decision.
3. Work in the current checkout on the current branch. `git checkout`,
   `git switch`, `git worktree add`, and `EnterWorktree` are for a session where
   the user asked for isolation. When a commit would land on the default branch,
   ask before branching.
4. Follow `.agents/rules/superpowers-policy.md` for artifact locations, workflow
   selection, and the verification cadence.
