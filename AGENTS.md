# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` imports this file via `@AGENTS.md`.

## What this repo is

**fuda** — a pnpm workspace monorepo.
`apps/*` are deployable surfaces (Cloudflare Workers via wrangler), `packages/*` are shared libraries. Both are empty at the time of writing; add packages under those folders and they join the workspace automatically.

Everything here is written from scratch inside the build window. Do not copy code, specs or designs in from other repositories, even sibling projects on this machine.

## Toolchain

One config file, `vite.config.ts`, drives dev/build/test/lint/format through **Vite+** (`vp`). Read its header comment before touching lint rules — it records which exclusions are structural and why.

- `pnpm lint` / `pnpm format` / `pnpm check` are the entry points (see `package.json` scripts). Plain `vp lint` runs the built-in; `vpr lint` runs the npm script.
- Lint is near-full-strict (Ultracite core + anti-slop + vitest presets). Suppress a rule only inline, with a reason:
  `// oxlint-disable-next-line <rule> -- <why>`. Keep these rare.
- `oxlint` / `oxfmt` are pinned in `pnpm-workspace.yaml` `overrides` to the versions vite-plus bundles. Two copies of oxlint installed at once break the preset types in `vite.config.ts`; keep the overrides in step when bumping vite-plus.
- Node `24.18.0` (`.node-version`, `engines`), pnpm with `engine-strict`. Install with `pnpm install --frozen-lockfile`.
- Wrangler local state (`.wrangler/`) and secrets (`.dev.vars*`) are gitignored per app.

## Agents

### Superpowers workflow and artifact policy

The full policy lives in `.agents/rules/superpowers-policy.md` (`.claude/rules/` is a symlink to `.agents/rules/`). Agents that resolve `@`-imports load it via the line below; other agents must read that file directly.

@.agents/rules/superpowers-policy.md
