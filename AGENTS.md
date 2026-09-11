# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` imports this file via `@AGENTS.md`.

## Start of task

Read [.agents/rules/start-of-task.md](.agents/rules/start-of-task.md) during read-only triage, before editing files or choosing a branch or worktree. Agents that resolve `@`-imports load it via the line below; other agents must read that file directly.

@.agents/rules/start-of-task.md

## Documentation

When changing product behavior or protocol contracts, read the relevant [canonical specification](docs/specs/README.md) and update it with the change. Use [the glossary](docs/CONTEXT.md) when choosing domain terms. For setup or deployment changes, update [the runbook](docs/runbook.md). The documentation hierarchy and verification cadence are defined in the workflow policy imported below.

## Repository layout

**fuda** is a pnpm workspace monorepo. `apps/*` contains deployable Cloudflare Workers, and direct children of `packages/*` with a `package.json` are shared workspace packages. Nested projects under `packages/subgraphs/` and `packages/substreams/` are built independently and do not join the pnpm workspace.

Author code, specifications, and designs from scratch within this repository's build window. Treat other repositories, including sibling projects on this machine, as out of scope for copying.

## Local verification artifacts

Save screenshots, recordings, and review evidence under `artifacts/<YYYY-MM-DD>-<task>/` at the repository root. This directory is Git-ignored: leave its contents local and exclude them from commits and merges unless the user explicitly requests otherwise. Use `/tmp` for disposable capture scripts, browser profiles, downloads, and intermediate logs.

When handing off captures, provide their absolute paths and identify the viewport, locale, theme, and any fictional data. Keep application assets, reusable tests, and canonical documentation in their normal tracked locations; do not make builds or tests depend on `artifacts/` or `/tmp`. The separate `.superpowers/` lifecycle below still applies to design specs and implementation plans.

## Toolchain

Vite+ (`vp`) drives frontend development and builds, workspace tests, linting, and formatting. Package-level `vite.config.ts` files configure app and test behavior; the root `vite.config.ts` holds shared lint and formatting policy. The API dev server uses Wrangler. Before changing lint rules, read the root file's header and the comments beside the relevant configuration; they record the structural exceptions and dependency constraints.

- Use the root `package.json` scripts as entry points, including `pnpm lint`, `pnpm format`, and `pnpm check`. Install with `pnpm install --frozen-lockfile`; pnpm provisions the repository's Node version. These commands are entry points, not a requirement to run every command at every workflow checkpoint; follow the verification cadence in `.agents/rules/superpowers-policy.md`.
- Keep lint strict. Suppress a rule only at the narrowest applicable line and include the reason: `// oxlint-disable-next-line <rule> -- <why>`.
- When upgrading Vite+, update the linked `oxlint`, `oxfmt`, and `vite-plus-core` overrides in `pnpm-workspace.yaml` together. The comments in that file explain why their versions must remain aligned.

## Conditional instructions

### Frontend design

When changing frontend UI or styling under `apps/app`, `apps/dash`, `apps/gate`, `packages/ui`, or `packages/styles`, read `.agents/rules/frontend-design.md` before editing.

### D1 writes

When building a variable-length, multi-row D1 statement, batch it below D1's limit of 100 bound parameters per statement.

### Superpowers workflow and artifact policy

The full policy lives in `.agents/rules/superpowers-policy.md` (`.claude/rules/` is a symlink to `.agents/rules/`). Agents that resolve `@`-imports load it via the line below; other agents must read that file directly.

@.agents/rules/superpowers-policy.md
