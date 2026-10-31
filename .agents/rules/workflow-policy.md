# Workflow and Documentation Policy

This file is imported by `AGENTS.md` (via `@.agents/rules/workflow-policy.md`; also reachable as `.claude/rules/` via symlink). It governs which documents are authoritative, where design decisions are recorded, and how often to verify.

## Documentation hierarchy

When determining the current behavior or intended specification of the system, use sources in this order:

1. **Tests and implementation** — actual current behavior
2. **`docs/specs/`** — current product and system specification
3. **`docs/adr/`** — durable architectural decisions and their rationale

If implementation or tests conflict with `docs/specs/`, do not silently choose one. Identify the discrepancy and update the canonical documentation as part of the change when appropriate.

Keep working notes, plans and task breakdowns out of the repository. Before a change lands, move anything worth keeping into `docs/`:

- an architectural decision and its rationale goes in an ADR;
- an operational pitfall or procedure goes in the runbook;
- a change in behavior goes in the relevant spec.

## Workspace order

1. Inspect and triage the current checkout read-only. Decide whether the task is routine direct work or has unresolved requirements, product semantics, interfaces, architecture or other design decisions.
2. Settle those design decisions with the user before editing. Agree on a design in chat; when the decision is architectural, record it as an ADR.
3. Work in the current checkout unless the user asked for isolation. A file changing is not by itself a reason to create a worktree.

When a feature branch is used, merge it with a merge commit or rebase, not squash, so Git history keeps the individual commits.

## Verification cadence

Treat verification as fresh until the checked content changes, rather than rerunning the same commands at every workflow boundary.

- During implementation, run the narrowest test, type check, lint, or build that exercises the changed behavior. Repeat targeted checks as the code changes.
- Before declaring a substantive change complete, run `pnpm check` and `pnpm test` once against the final content. Record which commands ran and their results in the handoff.
- Reuse that final verification for review, commit, and pre-merge gates while no tracked or untracked content has changed. A commit, rebase, or workflow transition alone does not invalidate results when it preserves the checked content.
- After a local merge, reuse the result when the merged tree is identical to the verified tree. If conflict resolution, upstream changes, generated output, or any other content changes the tree, rerun checks proportionate to the difference; use the full suite when the resulting interaction risk is broad or unclear.
- For documentation, ignore rules, and metadata-only changes, inspect the exact diff and run only a narrow structural check such as `git diff --check`. Run broader checks only when those files affect generated output, executable configuration, or runtime behavior.

A failed or stale result is never reusable. Review feedback or integration work that changes content starts a new targeted cycle and requires a new final verification before completion is claimed.

### Herdr controller/worker worktrees

Consider Herdr only after the user has asked for both worktree isolation and Herdr delegation. Its installation or availability alone does not trigger it, and it is never part of initial triage. An existing linked worktree takes precedence, and never gets a nested worktree.

- If `command -v herdr` reports that `herdr` is absent from `PATH`, use an ordinary Git worktree.
- If `herdr` is installed but `HERDR_ENV` is not `1`, do not control another Herdr session. Use an ordinary Git worktree and report that Herdr is inactive.
- If Herdr is installed, active, reachable, and compatible, let its controller create, supervise, adopt, integrate, and clean up the worktree. The worker never removes its own workspace.
- If Herdr is active but unreachable or incompatible, stop before changing anything. Do not silently fall back to an unmanaged Git worktree.

Baseline verification, dirty-worktree protection and confirmation before discarding work still apply either way.

## Canonical specifications

`docs/specs/` should describe **what the system does now**, not how a particular change was implemented.

Keep canonical specs focused on durable information such as:

- externally observable behavior
- product rules
- invariants
- interfaces and contracts
- security constraints
- compatibility requirements
- important system-level constraints

Avoid copying implementation details into canonical specs, including:

- task breakdowns
- file-by-file edit instructions
- intermediate migration steps that no longer apply
- commit instructions
- debugging notes
- implementation sequencing

## Architectural decisions

Use `docs/adr/` for decisions where future maintainers are likely to ask **why** the system was designed a particular way.

An ADR should capture the durable decision and rationale, not the complete implementation history.

Do not create an ADR for routine implementation choices that can be understood directly from the code.

## Small and bounded changes

Handle fully specified, local, reversible changes directly, without a design discussion. Examples include exact configuration changes, typo corrections, and mechanical edits with clear acceptance criteria.

Prefer the smallest amount of documentation necessary for the scope of the change.
