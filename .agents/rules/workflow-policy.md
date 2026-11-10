# Workflow policy

Which documents are authoritative, how work reaches `main`, and how often to verify.

## Before editing

Triage read-only. If the task leaves requirements, product behavior, interfaces or architecture open, settle them with the user first. A fully specified, local, reversible change needs no design discussion.

## Documents

When sources disagree, trust them in this order, and do not silently pick one: tests and implementation, then `docs/specs/`, then the other documents.

- `docs/specs/` says what the system does now: behavior, rules, interfaces, security constraints. No task breakdowns, edit lists or debugging notes.
- A decision future maintainers will question is recorded with its reason in the section it explains: a spec for product and protocol choices, `docs/architecture.md` for platform choices, the runbook for operational ones. Say what holds today and edit it in place; Git history keeps the earlier text. There are no separate decision records. Skip routine choices the code explains.
- The runbook holds operational procedures and pitfalls.

Keep working notes and plans out of the repository. Update the relevant document in the change that makes it wrong, using as little text as the change needs.

## Reaching main

Every change reaches `main` through a pull request. Merge with a merge commit, never squash, so history keeps each commit. Agents working in parallel each use their own worktree.

A feature that spans several pull requests uses one integration branch:

1. Create `feat/<topic>` from `main`. Record any architectural decision in the document it belongs to first.
2. Base every pull request on `feat/<topic>`, not on another pull request's branch. One that needs another's code waits until that code is merged there. Merge `main` in when it moves.
3. Review and merge each pull request into `feat/<topic>`.
4. Open one pull request from `feat/<topic>` to `main`. Run the full checks and an independent review of the combined change, then merge. Delete the branch last.

## Verification

A result stays valid until the checked content changes. Read each result before relying on it. A failed or stale result is never reported as passed.

- While working, run the narrowest check that exercises the change.
- Before calling a substantive change complete, run `pnpm check`, `pnpm test`, `pnpm fallow:audit` and, when a frontend or an api route changed, `pnpm e2e` once on the final content. Report what ran and its result.
- A commit or a clean merge that leaves the tree identical keeps the result. A change in content starts a new check, proportionate to the difference.
- For documentation and metadata, read the exact diff and run `git diff --check`, plus `pnpm check` when a formatted file changed.
- Say plainly what you could not verify, such as real devices and deployed services.
