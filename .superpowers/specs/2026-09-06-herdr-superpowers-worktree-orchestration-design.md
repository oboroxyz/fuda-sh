# Herdr–Superpowers Worktree Orchestration Design

**Date:** 2026-09-06  
**Status:** Approved for planning

## Problem

Fuda's Superpowers policy requires feature work to begin in an isolated
worktree before brainstorming. When Codex is already running as a controller
inside Herdr, the existing Superpowers flow can create a Git worktree but does
not create a Herdr workspace, start a worker agent there, retain control from
the original workspace, or remove the Herdr-owned workspace safely after the
work is integrated.

The integration must also degrade predictably when Herdr is not installed or
when Codex is not running in a Herdr-managed pane.

## Goals

- Let a controller Codex create a Herdr-managed worktree workspace and hand
  implementation to a worker Codex.
- Keep user decisions, worker supervision, branch integration, and worktree
  cleanup with the controller.
- Preserve enough durable state for a replacement controller to adopt an
  orphaned worker after the original controller closes.
- Retain the existing Superpowers worktree flow when Herdr is unavailable.
- Prefer abandoned-but-recoverable worktrees over automatic destructive
  cleanup.

## Non-goals

- Moving a running Codex process between Herdr workspaces.
- Teaching `using-superpowers` Herdr-specific CLI details.
- Automatically merging, discarding, force-removing, or answering a worker's
  approval prompt.
- Replacing Herdr's workspace, pane, agent, or worktree interfaces.

## Placement

The reusable orchestration belongs in a personal cross-runtime skill named
`orchestrating-herdr-worktrees` under `~/.agents/skills/`. Its small interface
is:

- **start** — create the worktree workspace and start the worker;
- **supervise** — observe the worker and relay decisions to the user;
- **adopt** — recover supervision after the original controller disappears;
- **finish** — integrate or preserve the branch, then clean up when authorized.

The repository's `.agents/rules/superpowers-policy.md` will contain only the
composition rule: use this adapter when it is both available and safe to
control, otherwise use the normal Superpowers worktree flow. The repository
policy continues to own Fuda-specific consent and artifact-lifecycle rules.

`using-superpowers` remains runtime-agnostic and unchanged. The first version
will not modify the generic `using-git-worktrees` or
`finishing-a-development-branch` skills; the repository policy will state
when the Herdr adapter satisfies and overrides their creation and cleanup
steps.

## Availability Decision

The controller evaluates availability before any mutation:

| State | Decision |
|---|---|
| `herdr` is absent from `PATH` | Use the normal Superpowers worktree flow. |
| `herdr` exists but `HERDR_ENV != 1` | Do not control another Herdr session; use the normal flow and report that Herdr is installed but inactive for this pane. |
| `herdr` exists, `HERDR_ENV = 1`, and the server is reachable and compatible | Use `orchestrating-herdr-worktrees`. |
| `herdr` exists and `HERDR_ENV = 1`, but the server is unreachable or incompatible | Stop before mutation and report the Herdr error. Do not silently create an unmanaged Git worktree. |

Installation detection uses `command -v herdr`. Active-pane detection uses
`HERDR_ENV`. Server health uses the installed CLI's read-only status command;
the installed binary remains the authority for syntax and compatibility.

If the controller is already inside a linked worktree, existing-isolation
detection wins and no nested worktree or worker is created.

## Actors and Invariants

### Controller

The original Codex remains in the source workspace. It owns:

- Herdr availability detection;
- worktree and worker creation;
- the user's approved design and task handoff;
- monitoring and relaying `blocked` questions;
- presenting integration choices;
- branch integration or preservation;
- cleanup from outside the worker worktree.

### Worker

The new Codex runs inside the returned Herdr worktree workspace. It owns
planning, implementation, and verification. It must not merge into the base
branch, delete the feature branch, close its own workspace, or remove its own
worktree. When ready, it reports status and evidence to the controller.

### Safety invariants

- Parse workspace, pane, and path identifiers from Herdr JSON responses.
- Never infer identifiers from UI ordering or labels.
- Never use `--force` for routine cleanup.
- Never remove a dirty worktree without an explicit user decision about every
  uncommitted or untracked file.
- Never close or remove a workspace the controller did not create or adopt.
- A worker reaching `blocked` is surfaced to the user; the controller does not
  invent an answer.
- Closing the controller never triggers automatic worker or worktree deletion.

## Start and Handoff Flow

1. Detect existing Git isolation and evaluate Herdr availability.
2. Capture the controller workspace and pane IDs plus the source repository,
   base branch, and task description.
3. Create a Herdr worktree workspace with an explicit feature branch, base
   ref, descriptive label, and `--no-focus`.
4. Parse the returned worker workspace ID, root pane ID, worktree path, and
   branch.
5. Persist the orchestration record under the source checkout's ignored
   `.superpowers/sdd/` directory.
6. Start a uniquely named Codex worker in the returned root pane.
7. Prompt the worker with the approved task context, repository instructions,
   required Superpowers phase, and the rule that the controller alone owns
   integration and cleanup.
8. Monitor the worker by agent name or returned pane ID. Keep user focus in
   the controller workspace unless the user asks to switch.

The orchestration record contains a format version, source repository,
controller workspace and pane IDs, worker workspace and pane IDs, worker agent
name, base branch, feature branch, worktree path, task summary, and lifecycle
phase. It is scratch state, not canonical documentation, and is deleted during
successful cleanup.

## Supervision and User Decisions

The controller uses Herdr's agent interface to wait for settled worker states.
On `blocked`, it reads the worker output and presents the question or approval
request to the user without answering it. On `idle` or `done`, it reads the
worker's result and either sends concrete follow-up work or moves to finishing.
An `unknown` state is diagnostic only and never proves completion.

The controller remains the only conversational authority for scope changes,
destructive actions, branch integration, and cleanup.

## Controller-loss Recovery

Herdr exposes controller and worker as independent workspaces; it does not
expose a parent-child lifecycle. Closing the controller therefore leaves the
worker workspace, agent process, branch, checkout, and uncommitted files in
place. A running worker may continue until it becomes idle, done, or blocked.
No merge or cleanup occurs automatically.

A replacement controller performs **adopt**:

1. Find orchestration records under `.superpowers/sdd/`.
2. Reconcile each record with `herdr worktree list`, `herdr workspace list`,
   and `herdr agent list` rather than trusting stale identifiers.
3. Inspect the worker using `agent get` and `agent read`.
4. Update the record with live identifiers and resume supervision.

If the Herdr session stopped, the worker process may no longer be running, but
the Git branch and checkout remain. The replacement controller opens the
existing checkout with `herdr worktree open`, starts a new worker, and hands it
the durable task state. Missing runtime state is treated as recoverable, not
as permission to delete the checkout.

If no orchestration record exists, recovery may use the branch, worktree path,
workspace label, and current Git status, but the controller must reconfirm the
base branch before integration.

## Finish and Cleanup Flow

1. Confirm the worker has stopped changing files and obtain its verification
   evidence.
2. Run the required final verification against the exact feature tree.
3. Present the standard Superpowers integration choices to the user.
4. For a local merge, integrate and verify from outside the worker worktree.
5. For a pull request or "keep as-is", preserve the worker workspace and
   orchestration record for later feedback.
6. After a verified local merge, confirm the worktree is clean and call
   `herdr worktree remove --workspace <worker-workspace-id>` without
   `--force`.
7. Delete the feature branch only after successful worktree removal, then
   delete the orchestration record.

An explicit discard follows the stricter confirmation rules from
`finishing-a-development-branch`. Removal refusal is evidence of unique files
and stops cleanup until the user chooses how to preserve or delete them.

## Failure Handling

- **Create fails:** report the Herdr error; do not start a worker or fall back
  silently when Herdr was active.
- **Worker startup fails:** keep the worktree, record its IDs, and allow retry
  or user-directed cleanup.
- **Prompt stalls:** inspect agent state and output before retrying.
- **Controller closes:** leave everything recoverable for `adopt`.
- **Worker exits:** preserve the worktree and start a replacement worker after
  inspecting Git state.
- **Cleanup fails:** preserve the branch, workspace, and record; report the
  exact refusal.
- **Recorded IDs are stale:** reconcile by repository, branch, and path before
  issuing any mutation.

## Verification Strategy

Skill behavior will be tested with realistic pressure scenarios before and
after authoring:

- Herdr binary absent;
- binary installed but the agent is outside Herdr;
- healthy Herdr controller starting and supervising a worker;
- active Herdr with an unavailable or incompatible server;
- controller loss followed by adoption;
- blocked worker requiring a user decision;
- clean post-merge cleanup;
- dirty worktree refusing cleanup;
- pull-request and keep-as-is paths preserving the workspace.

A disposable Herdr worktree will provide an end-to-end smoke test. Tests must
not close unrelated workspaces, must not use forced cleanup, and must leave no
test branch or checkout behind. The repository policy change will also be
checked for consistency with the existing artifact lifecycle and worktree-first
rules.
