# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` imports this file via `@AGENTS.md`.

## Start of task

Read `.agents/rules/start-of-task.md` before the first edit of any task. Agents
that resolve `@`-imports load it via the line below.

@.agents/rules/start-of-task.md

## Repository layout

**fuda** is a pnpm workspace monorepo. `apps/*` contains deployable Cloudflare
Workers, and direct children of `packages/*` with a `package.json` are shared
workspace packages. Nested projects under `packages/subgraphs/` and
`packages/substreams/` are built independently and do not join the pnpm
workspace.

Author code, specifications, and designs from scratch within this repository's
build window. Treat other repositories, including sibling projects on this
machine, as out of scope for copying.

## Toolchain

Vite+ (`vp`) drives development, builds, tests, linting, and formatting through
`vite.config.ts`. Before changing lint rules, read that file's header and the
comments beside the relevant configuration; they record the structural
exceptions and dependency constraints.

- Use the root `package.json` scripts as entry points, including `pnpm lint`,
  `pnpm format`, and `pnpm check`. Install with
  `pnpm install --frozen-lockfile`; pnpm provisions the repository's Node
  version. These commands are entry points, not a requirement to run every
  command at every workflow checkpoint; follow the verification cadence in
  `.agents/rules/superpowers-policy.md`.
- Keep lint strict. Suppress a rule only at the narrowest applicable line and
  include the reason:
  `// oxlint-disable-next-line <rule> -- <why>`.
- When upgrading Vite+, update the linked `oxlint`, `oxfmt`, and
  `vite-plus-core` overrides in `pnpm-workspace.yaml` together. The comments in
  that file explain why their versions must remain aligned.

## Conditional instructions

### Frontend design

When changing frontend UI or styling under `apps/app`, `apps/dash`, `apps/gate`,
`packages/ui`, or `packages/styles`, read `.agents/rules/frontend-design.md`
before editing.

### D1 writes

When building a variable-length, multi-row D1 statement, batch it below D1's
limit of 100 bound parameters per statement.

### Superpowers workflow and artifact policy

The full policy lives in `.agents/rules/superpowers-policy.md`
(`.claude/rules/` is a symlink to `.agents/rules/`). Agents that resolve
`@`-imports load it via the line below; other agents must read that file
directly.

@.agents/rules/superpowers-policy.md
