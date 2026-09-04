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
2. **`docs/spec/`** — current product and system specification
3. **`docs/adr/`** — durable architectural decisions and their rationale
4. **`.superpowers/specs/`** — temporary design snapshots for active work
5. **`.superpowers/plans/`** — temporary implementation instructions for active work

Never treat a completed Superpowers spec or plan as the current source of truth.

If an active Superpowers artifact conflicts with `docs/spec/`, explicitly determine whether the current task is intended to change the canonical specification before proceeding.

If implementation or tests conflict with `docs/spec/`, do not silently choose one. Identify the discrepancy and update the canonical documentation as part of the change when appropriate.

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

1. Update `docs/spec/` with any durable changes to behavior, requirements, interfaces, or constraints.
2. Add or update `docs/adr/` only when an architectural decision and its rationale are worth preserving.
3. Delete the completed design spec from `.superpowers/specs/`.
4. Delete the completed implementation plan from `.superpowers/plans/`.
5. Include those documentation updates and artifact deletions in the completed change.

Do not preserve completed Superpowers artifacts merely for historical reference. Git history is the archive.

Do not rewrite an old completed plan or design spec to describe new behavior. For a new architectural change, create a new temporary artifact for that change.

## Canonical specifications

`docs/spec/` should describe **what the system does now**, not how a particular change was implemented.

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

Do not create persistent design or plan files for changes that the applicable Superpowers workflow classifies as bounded and handles with an in-chat design.

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
- [ ] `docs/spec/` reflects the resulting current behavior, if needed.
- [ ] Relevant architectural rationale is captured in `docs/adr/`, if needed.
- [ ] Completed `.superpowers/specs/` artifacts are deleted.
- [ ] Completed `.superpowers/plans/` artifacts are deleted.
- [ ] No temporary artifact is being relied on as canonical documentation.
