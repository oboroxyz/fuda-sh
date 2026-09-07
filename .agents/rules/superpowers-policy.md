# Superpowers Workflow and Artifact Policy

This file is imported by `AGENTS.md` (via `@.agents/rules/superpowers-policy.md`; also reachable as `.claude/rules/` via symlink). It governs how Superpowers skills are used in this repository and where their artifacts live.

Use Superpowers skills for design, planning, implementation, debugging, and review when applicable.

Superpowers design specs and implementation plans are **temporary development artifacts**. They capture the reasoning and execution plan for a change at a point in time. They are not authoritative documentation for the current system.

## Artifact locations

Store Superpowers-generated artifacts under:

```text
.superpowers/
├── specs/
│   └── YYYY-MM-DD-<topic>-design.md
└── plans/
    └── YYYY-MM-DD-<feature>.md
```

Do not store Superpowers specs or plans under `docs/`.

When a Superpowers skill specifies its default location under `docs/superpowers/`, override that location with the paths above.

## Documentation hierarchy

When determining the current behavior or intended specification of the system, use sources in this order:

1. **Tests and implementation** — actual current behavior
2. **`docs/specs/`** — current product and system specification
3. **`docs/adr/`** — durable architectural decisions and their rationale
4. **`.superpowers/specs/`** — temporary design snapshots for active work
5. **`.superpowers/plans/`** — temporary implementation instructions for active work

Never treat a completed Superpowers spec or plan as the current source of truth.

If an active Superpowers artifact conflicts with `docs/specs/`, explicitly determine whether the current task is intended to change the canonical specification before proceeding.

If implementation or tests conflict with `docs/specs/`, do not silently choose one. Identify the discrepancy and update the canonical documentation as part of the change when appropriate.

## Workflow selection and workspace order

Choose the workflow before choosing the workspace:

1. Inspect and triage the current checkout read-only. Determine whether the
   task is routine direct work or has unresolved requirements, product
   semantics, interfaces, architecture, or other design decisions.
2. Read `Skill(using-superpowers)` and let it classify the task. Only a triage
   that lands on fully specified, local, reversible work skips it: make the edit
   directly in the current checkout, preserve unrelated changes, and run a
   proportionate targeted check. A file changing is not by itself a reason to
   create a worktree or evaluate orchestration.
3. When unresolved complexity exists, invoke the smallest applicable
   Superpowers workflow. If brainstorming establishes that a persistent design
   spec or implementation plan is needed, decide whether isolation is useful
   **before** writing that artifact. A need for a spec or plan prompts the
   worktree decision; it does not decide it automatically. Explicit user
   preference wins.
4. If isolation is selected, invoke `using-git-worktrees`, then write the
   artifacts and perform implementation in that workspace. If isolation is not
   selected, continue in the current checkout with the same artifact lifecycle.

When a feature branch is used, keep every temporary artifact and its deletion
on that branch. Merge it with a merge commit or rebase, not squash, so that Git
history remains the archive for the lifecycle below.

## Verification cadence

Treat verification as fresh until the checked content changes, rather than
rerunning the same commands at every workflow boundary. This repository policy
overrides generic workflow steps that would repeat a full suite solely because
work moved from implementation to review, completion, or integration.

- During implementation, run the narrowest test, type check, lint, or build
  that exercises the changed behavior. Repeat targeted checks as the code
  changes.
- Before declaring a substantive change complete, run `pnpm check` and
  `pnpm test` once against the final content. Record which commands ran and
  their results in the handoff.
- Reuse that final verification for review, commit, and pre-merge gates while
  no tracked or untracked content has changed. A commit, rebase, or workflow
  transition alone does not invalidate results when it preserves the checked
  content.
- After a local merge, reuse the result when the merged tree is identical to
  the verified tree. If conflict resolution, upstream changes, generated
  output, or any other content changes the tree, rerun checks proportionate to
  the difference; use the full suite when the resulting interaction risk is
  broad or unclear.
- For documentation, ignore rules, and metadata-only changes, inspect the
  exact diff and run only a narrow structural check such as
  `git diff --check`. Run broader checks only when those files affect generated
  output, executable configuration, or runtime behavior.

A failed or stale result is never reusable. Review feedback or integration
work that changes content starts a new targeted cycle and requires a new final
verification before completion is claimed.

### Herdr controller/worker worktrees

Evaluate `orchestrating-herdr-worktrees` only after both worktree isolation and
Herdr delegation have been selected. Installation or availability alone does
not trigger it, and it is never part of initial triage. Existing
linked-worktree isolation still wins and never creates a nested worktree.

- If `command -v herdr` reports that `herdr` is absent from `PATH`, use the
  ordinary Superpowers flow.
- If `herdr` is installed but `HERDR_ENV` is not `1`, do not control another
  Herdr session; use the ordinary flow and report the inactive context.
- If Herdr is installed, active, reachable, and compatible, use
  `orchestrating-herdr-worktrees`. Its controller performs creation,
  supervision, adoption, integration, and cleanup; the worker never removes
  its own workspace.
- If Herdr is active but unreachable or incompatible, stop before mutation.
  Do not silently fall back to an unmanaged Git worktree.

The Herdr adapter satisfies and overrides the creation portion of
`using-git-worktrees` and the worktree-cleanup portion of
`finishing-a-development-branch`. All other requirements of those skills,
including existing-isolation detection, baseline verification, integration
choices, dirty-worktree protection, and discard confirmation, still apply.

## Artifact lifecycle

Superpowers artifacts exist only for the lifetime of the change they support.

The lifecycle is:

```text
idea / requirement
    ↓
.superpowers/specs/
    ↓
.superpowers/plans/
    ↓
implementation
    ↓
tests / verification
    ↓
update canonical docs
    ↓
delete temporary artifacts
```

After a change is fully implemented and verified:

1. Update `docs/specs/` with any durable changes to behavior, requirements, interfaces, or constraints.
2. Add or update `docs/adr/` only when an architectural decision and its rationale are worth preserving.
3. Delete the completed design spec from `.superpowers/specs/`.
4. Delete the completed implementation plan from `.superpowers/plans/`.
5. Include those documentation updates and artifact deletions in the completed change.

Do not preserve completed Superpowers artifacts merely for historical reference. Git history is the archive.

Do not rewrite an old completed plan or design spec to describe new behavior. For a new architectural change, create a new temporary artifact for that change.

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

Avoid copying implementation-plan details into canonical specs, including:

- temporary task breakdowns
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

Handle fully specified, local, reversible changes directly without invoking a
Superpowers workflow or seeking a design approval. Examples include exact
configuration changes, typo corrections, and mechanical edits with clear
acceptance criteria.

When brainstorming legitimately applies but classifies the remaining design
question as bounded, handle it with an in-chat design and do not create
persistent design or plan files.

Prefer the smallest amount of documentation necessary for the scope of the change.

Escalate to a temporary design spec and implementation plan when the change becomes architectural, crosses subsystem boundaries, or changes interfaces or durable system behavior.

## Active vs. completed artifacts

Files under `.superpowers/` should normally correspond only to work that is currently active.

A file in `.superpowers/` means:

> This change is currently being designed or implemented. The contents may describe intended future behavior that does not exist yet.

It must never imply:

> This is documentation for how the current production system works.

Before using information from `.superpowers/`, determine whether the referenced change is still active.

## Repository search

Treat `.superpowers/` as historical/working context rather than normal source code or documentation search scope.

Routine repository searches should exclude `.superpowers/` unless:

- implementing the active plan,
- reviewing the active design,
- investigating the history of a previous change, or
- the user explicitly asks to search Superpowers artifacts.

Prefer Git history when investigating completed Superpowers work.

## Completion checklist

Before declaring Superpowers-driven work complete, verify:

- [ ] Implementation matches the approved design.
- [ ] Relevant tests pass.
- [ ] `docs/specs/` reflects the resulting current behavior, if needed.
- [ ] Relevant architectural rationale is captured in `docs/adr/`, if needed.
- [ ] Completed `.superpowers/specs/` artifacts are deleted.
- [ ] Completed `.superpowers/plans/` artifacts are deleted.
- [ ] No temporary artifact is being relied on as canonical documentation.
