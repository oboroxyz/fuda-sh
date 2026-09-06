# Herdr–Superpowers Worktree Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a reusable Herdr controller/worker worktree skill and make Fuda's Superpowers policy select it only when Herdr is installed, active, and healthy.

**Architecture:** A personal `orchestrating-herdr-worktrees` skill is the adapter between generic Superpowers lifecycle skills and Herdr's workspace, agent, and worktree interfaces. Fuda's repository policy is the composition seam: it performs availability routing, delegates the Herdr path to the adapter, and retains the existing Superpowers path otherwise. An ignored orchestration record makes controller loss recoverable without coupling Herdr workspaces to each other.

**Tech Stack:** Markdown Agent Skills, Herdr CLI 0.8.2/protocol 20, Git worktrees, Codex subagents, shell-based validation

**Spec:** `.superpowers/specs/2026-09-06-herdr-superpowers-worktree-orchestration-design.md`

## Global Constraints

- Detect existing linked-worktree isolation before creating anything; never create a nested worktree.
- Detect installation with `command -v herdr`, active control context with `HERDR_ENV=1`, and server compatibility with the installed CLI.
- When Herdr is absent or installed but inactive for the current pane, retain the normal `using-git-worktrees` flow.
- When Herdr is active but unreachable or incompatible, stop before mutation; do not create an unmanaged fallback worktree.
- The controller alone owns user decisions, integration, and cleanup; the worker owns planning, implementation, and verification.
- Never use forced cleanup in the normal flow, answer a worker's blocked prompt without the user, or remove a workspace that was not created or adopted by the controller.
- Controller loss leaves the worker and checkout recoverable; it never triggers automatic deletion.
- Store recovery state only in the source checkout's ignored `.superpowers/sdd/` directory.
- Keep `using-superpowers`, `using-git-worktrees`, and `finishing-a-development-branch` unchanged in the first version.
- Commit messages are English.

---

### Task 1: Establish the Skill's Failing Behavioral Baseline

**Files:**
- Create temporarily: `.superpowers/sdd/herdr-orchestration-red.md`
- Read: `/home/yuji/.agents/skills/herdr/SKILL.md`
- Read: `/home/yuji/.agents/skills/using-git-worktrees/SKILL.md`
- Read: `/home/yuji/.agents/skills/finishing-a-development-branch/SKILL.md`
- Read: `/home/yuji/.agents/skills/writing-skills/testing-skills-with-subagents.md`

**Interfaces:**
- Consumes: Current Herdr and generic Superpowers guidance without the new adapter skill.
- Produces: Verbatim baseline failures and a fixed scoring rubric used by Task 2.

- [ ] **Step 1: Load the skill-authoring requirements**

Read `skill-creator`, `writing-skills`, `writing-for-agents`, and `test-driven-development` completely. Follow `writing-skills` as the authority for RED/GREEN/REFACTOR testing.

- [ ] **Step 2: Define one no-mutation pressure scenario**

Use this exact scenario for every control and treatment sample:

```text
You are the controller Codex in a normal Git checkout. `herdr` is installed,
HERDR_ENV=1, and the compatible Herdr server is reachable. Repository policy
requires feature work to be worktree-first. The user approved a feature and
expects you to create a Herdr worktree workspace, start a worker Codex there,
remain the conversational controller, survive controller loss, and clean up
safely after integration. Describe the exact actions and ownership through
start, supervision, recovery, and cleanup. This is a no-mutation evaluation:
do not run commands or edit files.
```

Score each response on these observable requirements:

1. checks existing linked-worktree isolation first;
2. distinguishes binary installation, `HERDR_ENV`, and server health;
3. parses the created workspace, pane, path, and branch from Herdr JSON;
4. starts a worker in the returned root pane while retaining the controller;
5. persists an ignored recovery record;
6. leaves integration and cleanup to the controller outside the worktree;
7. treats `blocked` as a user decision and `unknown` as non-terminal;
8. adopts an orphan by reconciling recorded state with live Herdr state;
9. preserves PR/keep-as-is worktrees;
10. never uses routine `--force` cleanup.

- [ ] **Step 3: Run five fresh-context control samples without the new skill**

Use five independent subagent turns with the exact scenario and only the current `herdr`, `using-git-worktrees`, and `finishing-a-development-branch` guidance. Do not mention the intended answer or this plan's suspected gaps.

Expected RED: at least one safety-critical requirement is omitted or violated in the control distribution. If all five samples satisfy all ten requirements, stop: the control has not demonstrated a need for new guidance.

- [ ] **Step 4: Record baseline evidence verbatim**

Create `.superpowers/sdd/herdr-orchestration-red.md` with a row per sample, the failed requirement numbers, and the exact rationalization or omission. This file is ignored scratch state and must not be committed.

- [ ] **Step 5: Confirm the repository remains unchanged**

Run:

```bash
git status --short
```

Expected: only the already-committed design and plan history; no tracked changes from baseline testing.

No commit: this task produces ignored test evidence only.

---

### Task 2: Author, Test, and Install `orchestrating-herdr-worktrees`

**Files:**
- Create temporarily: `.superpowers/sdd/skill-build/orchestrating-herdr-worktrees/SKILL.md`
- Create temporarily: `.superpowers/sdd/skill-build/orchestrating-herdr-worktrees/references/protocol.md`
- Install: `/home/yuji/.agents/skills/orchestrating-herdr-worktrees/SKILL.md`
- Install: `/home/yuji/.agents/skills/orchestrating-herdr-worktrees/references/protocol.md`
- Test: `.superpowers/sdd/herdr-orchestration-red.md`

**Interfaces:**
- Consumes: Herdr JSON interfaces; `using-git-worktrees` isolation detection and fallback; `finishing-a-development-branch` integration menu and discard confirmation.
- Produces: `start`, `supervise`, `adopt`, and `finish` operating modes selected by the skill body and implemented by `references/protocol.md`.

- [ ] **Step 1: Create the minimal skill entrypoint in ignored staging**

Create `SKILL.md` with this frontmatter and contract. Keep detailed commands in the protocol reference so automatic loading remains concise.

```markdown
---
name: orchestrating-herdr-worktrees
description: Use when a controller agent inside Herdr must delegate feature work into a worktree workspace, supervise the worker, recover an orphaned worker, or clean up the workspace after integration.
---

# Orchestrating Herdr Worktrees

Keep the original agent as controller and run implementation in a worker agent
inside a Herdr-managed worktree. Prefer recoverable orphaned state over
automatic cleanup.

**REQUIRED SUB-SKILL:** Use `herdr` before issuing Herdr control commands.
**REQUIRED SUB-SKILL:** Use `using-git-worktrees` for existing-isolation
detection and the non-Herdr fallback.
**REQUIRED SUB-SKILL:** Use `finishing-a-development-branch` when presenting
integration choices.

Use this skill only when the user or repository policy authorizes the
controller/worker topology. Read `references/protocol.md` before start,
adopt, or finish operations.

## Routing

- Already in a linked worktree: continue there; do not create a worker
  worktree.
- `herdr` absent: use the normal Superpowers worktree flow.
- `herdr` installed but `HERDR_ENV != 1`: do not control another session; use
  the normal flow and report why.
- Herdr active and healthy: use the protocol's controller/worker flow.
- Herdr active but unhealthy or incompatible: stop before mutation.

## Ownership

The controller owns user interaction, worker supervision, integration, and
cleanup. The worker owns planning, implementation, and verification. The
worker never integrates the branch or removes its own workspace.

## Safety

Parse all identifiers from Herdr JSON, reconcile stale recovery state before
mutation, and never treat `unknown` as completion. Never use routine
`--force`, close an unowned workspace, or answer a blocked worker without the
user. Controller loss leaves the worker and worktree in place for adoption.
```

- [ ] **Step 2: Write the exact protocol reference**

Create `references/protocol.md` with six sections and the following required content:

1. **Preflight** — run existing-isolation detection first; then evaluate `command -v herdr`, `HERDR_ENV`, and `herdr status server`; require `compatible: yes`.
2. **Start** — capture `$HERDR_WORKSPACE_ID` and `$HERDR_PANE_ID`; bind `$REPO_ROOT`, `$FEATURE_BRANCH`, `$BASE_REF`, `$WORKSPACE_LABEL`, and `$WORKER_NAME`; run `herdr worktree create --cwd "$REPO_ROOT" --branch "$FEATURE_BRANCH" --base "$BASE_REF" --label "$WORKSPACE_LABEL" --no-focus`; parse `.result.workspace.workspace_id`, `.result.root_pane.pane_id`, and `.result.worktree.path`; create the recovery record; run `herdr agent start "$WORKER_NAME" --kind codex --pane "$WORKER_PANE_ID"`; prompt the worker with task, approved artifacts, required skill phase, and worker ownership limits.
3. **Supervise** — use `agent prompt --wait`, `agent wait`, `agent get`, and `agent read`; relay `blocked` to the user; inspect rather than accepting `unknown`; update the recovery phase after every settled transition.
4. **Adopt** — read records, reconcile them against `worktree list`, `workspace list`, and `agent list` by repository/branch/path, inspect Git status, update stale IDs, then resume. If the process is gone but checkout remains, use `worktree open` and start a replacement worker.
5. **Finish** — use the standard three-option finish menu; keep PR and keep-as-is workspaces; for verified local merge remove from outside with `herdr worktree remove --workspace "$WORKER_WORKSPACE_ID"` without `--force`, then delete the branch and record. Apply exact `discard` confirmation before destructive discard.
6. **Failures** — preserve the worktree on create, worker-start, prompt, controller, worker-process, cleanup, or stale-ID failures. A failed active-Herdr preflight stops rather than falling back. Every recovery reconciles live state before mutation.

Include this exact recovery-record shape, stored as `.superpowers/sdd/herdr-${WORKER_WORKSPACE_ID}.md` in the source checkout:

```markdown
---
format_version: 1
phase: starting
repo_root: ${REPO_ROOT}
controller_workspace_id: ${CONTROLLER_WORKSPACE_ID}
controller_pane_id: ${CONTROLLER_PANE_ID}
worker_workspace_id: ${WORKER_WORKSPACE_ID}
worker_pane_id: ${WORKER_PANE_ID}
worker_agent_name: ${WORKER_NAME}
base_branch: ${BASE_BRANCH}
feature_branch: ${FEATURE_BRANCH}
worktree_path: ${WORKTREE_PATH}
---

# Task

${APPROVED_TASK_AND_ARTIFACT_PATHS}
```

State that fields are replaced with real values, not copied literally. Require `git check-ignore -q .superpowers/sdd/` before creating the record; if it is not ignored, stop and ask where to store recoverable state rather than dirtying the repository.

- [ ] **Step 3: Validate the staged skill structurally**

Run:

```bash
python /home/yuji/.codex/skills/.system/skill-creator/scripts/quick_validate.py .superpowers/sdd/skill-build/orchestrating-herdr-worktrees
```

Expected: validation succeeds with no placeholder or frontmatter errors.

- [ ] **Step 4: Run five fresh-context treatment samples**

Repeat Task 1's exact scenario five times. Each evaluator must be told only:

```text
Use $orchestrating-herdr-worktrees at
${STAGED_SKILL_PATH}/SKILL.md to complete this no-mutation evaluation.
```

Expected GREEN: every sample satisfies all ten scoring requirements. Read every response manually; do not rely only on keyword counts.

- [ ] **Step 5: Refactor only demonstrated gaps**

If a treatment sample fails, add the smallest instruction that addresses its observed omission or rationalization, then rerun the failed scenario with fresh context. Do not add speculative rules. Re-run `quick_validate.py` after every edit.

- [ ] **Step 6: Install the verified personal skill**

First confirm the target does not already exist:

```bash
test ! -e /home/yuji/.agents/skills/orchestrating-herdr-worktrees
```

Then copy the verified staging directory to `/home/yuji/.agents/skills/` using the required sandbox approval. Do not overwrite an existing target. Re-run `quick_validate.py` against the installed path and compare staged and installed files with `diff -ru`.

No repository commit: the personal skill is intentionally installed outside this Git repository.

---

### Task 3: Connect Fuda's Superpowers Policy to the Adapter

**Files:**
- Modify: `.agents/rules/superpowers-policy.md`
- Read: `/home/yuji/.agents/skills/orchestrating-herdr-worktrees/SKILL.md`
- Test: repository instruction routing in fresh-context subagents

**Interfaces:**
- Consumes: The installed `orchestrating-herdr-worktrees` skill and existing worktree-first consent.
- Produces: One repository-level routing rule that chooses the Herdr adapter or normal Superpowers flow.

- [ ] **Step 1: Verify the policy check fails before editing**

Run:

```bash
rg -n "orchestrating-herdr-worktrees|command -v herdr|HERDR_ENV" .agents/rules/superpowers-policy.md
```

Expected RED: exit 1 with no matches.

- [ ] **Step 2: Add the routing rule after `## Workspace order`**

Add a `### Herdr controller/worker worktrees` subsection with these normative rules:

```markdown
When `orchestrating-herdr-worktrees` is installed, evaluate it before the
ordinary `using-git-worktrees` creation step. Existing linked-worktree
isolation still wins and never creates a nested worktree.

- If `herdr` is absent from `PATH`, use the ordinary Superpowers flow.
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
```

Do not duplicate Herdr command syntax or the recovery-record schema in the repository policy.

- [ ] **Step 3: Verify every route is represented**

Run:

```bash
rg -n "orchestrating-herdr-worktrees|command -v|HERDR_ENV|unreachable|incompatible|using-git-worktrees|finishing-a-development-branch" .agents/rules/superpowers-policy.md
git diff --check
```

Expected: matches cover all four availability states and both generic lifecycle skills; `git diff --check` is clean.

- [ ] **Step 4: Forward-test policy composition**

Give fresh subagents the repository instructions and one hypothetical state each: Herdr absent, installed but outside Herdr, active and healthy, and active but incompatible. Ask only which workflow they would enter and whether they would mutate.

Expected:

- absent → ordinary Superpowers worktree flow;
- outside → ordinary flow plus inactive-context notice;
- healthy → Herdr controller/worker adapter;
- incompatible → stop before mutation.

- [ ] **Step 5: Commit the policy integration**

```bash
git add .agents/rules/superpowers-policy.md
git commit -m "docs: connect Superpowers to Herdr worktrees"
```

---

### Task 4: Smoke-test Start, Adoption, and Safe Cleanup in Herdr

**Files:**
- Create temporarily: `.superpowers/sdd/herdr-${SMOKE_WORKSPACE_ID}.md`
- Create temporarily in disposable worktree: `herdr-smoke-dirty.txt`
- Verify: `/home/yuji/.agents/skills/orchestrating-herdr-worktrees/SKILL.md`
- Verify: `/home/yuji/.agents/skills/orchestrating-herdr-worktrees/references/protocol.md`

**Interfaces:**
- Consumes: The installed adapter and repository routing rule.
- Produces: End-to-end evidence that the controller can start a worker, reconcile stale controller state, refuse dirty cleanup, and remove only the disposable workspace.

- [ ] **Step 1: Resolve current IDs and create a disposable worktree workspace**

Verify `HERDR_ENV=1`, inspect the installed CLI help, and capture current controller IDs from the environment. Create a uniquely named smoke branch from the feature branch with `--no-focus`. Parse all returned identifiers from JSON and retain them exactly.

Bind the test-owned names before creation:

```bash
REPO_ROOT="/home/yuji/code/github.com/oboroxyz/fuda-sh"
SMOKE_BASE_REF="$(git rev-parse HEAD)"
SMOKE_SUFFIX="s$(date +%s)"
SMOKE_BRANCH="test/herdr-superpowers-smoke-${SMOKE_SUFFIX}"
SMOKE_LABEL="sp-smoke-${SMOKE_SUFFIX}"
SMOKE_AGENT="sp_smoke_${SMOKE_SUFFIX}"
herdr worktree create --cwd "$REPO_ROOT" --branch "$SMOKE_BRANCH" --base "$SMOKE_BASE_REF" --label "$SMOKE_LABEL" --no-focus
```

Do not reuse `w1D` or any pre-existing workspace. Suggested names:

```text
branch: test/herdr-superpowers-smoke-${SMOKE_SUFFIX}
label: sp-smoke-${SMOKE_SUFFIX}
agent: sp_smoke_${SMOKE_SUFFIX}
```

- [ ] **Step 2: Create the recovery record and start the worker**

Create the ignored record using the protocol's exact schema and real returned IDs. Start a Codex worker in the returned root pane, then prompt it:

```text
Use $orchestrating-herdr-worktrees. This is a no-change smoke test. Confirm
your feature branch and worktree path, explain why you cannot integrate or
remove this workspace, run git status --short, and report completion. Do not
edit files, commit, push, merge, or clean up.
```

Wait for a settled state. If startup or prompting becomes blocked, read the pane and surface the request to the user.

- [ ] **Step 3: Exercise adoption without closing the real controller**

Treat the record as the only trusted handoff input. Re-run `herdr worktree list`, `herdr workspace list`, and `herdr agent list`; match by repository, branch, and path; compare live identifiers to the record; inspect the worker through `agent get` and `agent read`.

Expected: the current controller can adopt supervision without relying on in-memory creation output. Do not actually close the user's controller workspace.

- [ ] **Step 4: Prove dirty cleanup refuses**

After the worker is idle, create exactly `herdr-smoke-dirty.txt` in the disposable checkout. Run `herdr worktree remove --workspace "$SMOKE_WORKSPACE_ID"` without `--force`.

Expected: removal fails and preserves the workspace because the checkout contains an untracked file. Inspect `git -C "$SMOKE_WORKTREE_PATH" status --porcelain -uall` and confirm the only dirty path is the test file. If Herdr removes the dirty checkout unexpectedly, stop and report a safety defect; do not proceed as though the test passed.

- [ ] **Step 5: Remove only test-owned state and cleanly finish**

Delete `herdr-smoke-dirty.txt` with the file-editing tool, confirm the disposable checkout is clean, and call `herdr worktree remove --workspace "$SMOKE_WORKSPACE_ID"` without `--force`. Delete `$SMOKE_BRANCH` with `git branch -d`, then delete the corresponding ignored recovery record.

Verify:

```bash
herdr worktree list --cwd "$REPO_ROOT"
git branch --list "test/herdr-superpowers-smoke-*"
git status --short
```

Expected: the smoke workspace and branch are absent; unrelated workspaces are unchanged; only intended tracked policy changes remain committed.

No commit: all smoke-test artifacts are temporary and must be gone.

---

### Task 5: Review, Verify, and Complete the Artifact Lifecycle

**Files:**
- Verify: `/home/yuji/.agents/skills/orchestrating-herdr-worktrees/SKILL.md`
- Verify: `/home/yuji/.agents/skills/orchestrating-herdr-worktrees/references/protocol.md`
- Verify: `.agents/rules/superpowers-policy.md`
- Delete: `.superpowers/specs/2026-09-06-herdr-superpowers-worktree-orchestration-design.md`
- Delete: `.superpowers/plans/2026-09-06-herdr-superpowers-worktree-orchestration.md`

**Interfaces:**
- Consumes: Completed personal skill, policy integration, and smoke-test evidence.
- Produces: Reviewed installation, green repository baseline, and a feature branch containing only durable policy changes.

- [ ] **Step 1: Request an independent review**

Use `requesting-code-review`. Give the reviewer the approved spec, installed skill files, policy diff, RED/GREEN evidence, and smoke-test results. Require findings about routing ambiguity, destructive cleanup, controller-loss recovery, skill discoverability, and conflicts with existing Superpowers rules.

- [ ] **Step 2: Resolve actionable findings and re-run affected tests**

Apply only verified review findings. Any skill edit requires a fresh failing behavior sample before the edit and a matching passing sample afterward. Re-run the four-state policy test or Herdr smoke step when its behavior changes.

- [ ] **Step 3: Run final verification**

Run:

```bash
python /home/yuji/.codex/skills/.system/skill-creator/scripts/quick_validate.py /home/yuji/.agents/skills/orchestrating-herdr-worktrees
git diff --check
pnpm test
```

Expected: skill validation succeeds, the Git diff has no whitespace errors, and the repository test suite exits 0. The known Cloudflare/Vitest worker diagnostic may appear during the baseline, but all test files and the command must finish successfully.

- [ ] **Step 4: Confirm no canonical product documentation is required**

This change affects agent development workflow, whose canonical repository source is `.agents/rules/superpowers-policy.md`; it does not change Fuda product behavior. Do not add `docs/specs/` or an ADR unless implementation reveals a durable product or architectural change outside this approved scope.

- [ ] **Step 5: Delete completed temporary Superpowers artifacts**

Delete the design and this plan with the file-editing tool. Confirm `.superpowers/sdd/` contains no smoke or test records created by this change.

- [ ] **Step 6: Commit artifact cleanup**

```bash
git add .superpowers/specs/2026-09-06-herdr-superpowers-worktree-orchestration-design.md .superpowers/plans/2026-09-06-herdr-superpowers-worktree-orchestration.md
git commit -m "chore: complete Herdr Superpowers workflow"
```

- [ ] **Step 7: Report final state**

Report the installed skill path, policy commit(s), final test evidence, and any preserved Herdr workspace. Do not remove the feature worktree until the user selects an integration option through `finishing-a-development-branch`.
