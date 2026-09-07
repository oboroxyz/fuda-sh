# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` imports this file via `@AGENTS.md`.

## What this repo is

**fuda** — a pnpm workspace monorepo.
`apps/*` are deployable surfaces (Cloudflare Workers via wrangler), while `packages/*` contains shared libraries and reusable packages. Direct children with a `package.json` join the pnpm workspace automatically. `packages/substreams/` is an organizational directory for independently built Rust/Substreams packages, not a pnpm workspace package.

Everything here is written from scratch inside the build window. Do not copy code, specs or designs in from other repositories, even sibling projects on this machine.

## Toolchain

One config file, `vite.config.ts`, drives dev/build/test/lint/format through **Vite+** (`vp`). Read its header comment before touching lint rules — it records which exclusions are structural and why.

- `pnpm lint` / `pnpm format` / `pnpm check` are the entry points (see `package.json` scripts). Plain `vp lint` runs the built-in; `vpr lint` runs the npm script.
- Lint is near-full-strict (Ultracite core + anti-slop + vitest presets). Suppress a rule only inline, with a reason:
  `// oxlint-disable-next-line <rule> -- <why>`. Keep these rare.
- An `overrides` entry in `vite.config.ts`'s `lint` config only inherits the top-level (non-test) `plugins` list; it does not inherit any preset's plugin list. To set rules from a preset's plugin (e.g. `vitest/*`) inside an override, that override must repeat the plugin in its own `plugins: [...]` array, or those rule keys are silently dropped — see the vitest override in `vite.config.ts` for the working pattern.
- `oxlint` / `oxfmt` are pinned in `pnpm-workspace.yaml` `overrides` to the versions vite-plus bundles. Two copies of oxlint installed at once break the preset types in `vite.config.ts`; keep the overrides in step when bumping vite-plus. A third override there, `vite@*` → `@voidzero-dev/vite-plus-core@<version>`, redirects any third-party Vite plugin's `vite` peer (e.g. `@tailwindcss/vite`) to the same vite-plus-core release the workspace uses, so its `Plugin`/`UserConfig` types stay unified with `vite-plus`'s instead of splitting into two nominally distinct types — see the override's comment in `pnpm-workspace.yaml` for the full rationale. Bump this override's version together with vite-plus too.
- Node `24.18.0` is provisioned by pnpm itself (`devEngines.runtime` in `package.json`, `onFail: download`); no version manager needed. `engineStrict` / `autoInstallPeers` live in `pnpm-workspace.yaml` because pnpm 11 ignores `.npmrc` for them. Install with `pnpm install --frozen-lockfile`.
- Wrangler local state (`.wrangler/`) and secrets (`.dev.vars*`) are gitignored per app.
- D1 caps bound parameters at 100 per statement, so a multi-row `INSERT` built
  from a variable-length list must be sliced into batches under that cap.

## Agents

### Frontend styling

For `apps/app`, `apps/dash`, and `apps/gate`, import `tailwindcss` and then
`@fuda/styles/base.css` from the app's `src/styles.css`. Keep variables, base
rules, and reusable `.fuda-*` classes emitted by `packages/ui` in
`packages/styles/base.css`; keep each product's visual design in its app.
Prefer Tailwind utilities in TSX and `@apply` for reusable selector-driven
rules. Use CSS declarations for custom properties, keyframes, pseudo-elements,
compound state selectors, and expressions that Tailwind cannot represent
clearly. Compose conditional or potentially conflicting class names with `cn`;
keep static classes as string literals. Declare `cn` as a direct dependency of
each app or package that imports it.

### Superpowers workflow and artifact policy

The full policy lives in `.agents/rules/superpowers-policy.md` (`.claude/rules/` is a symlink to `.agents/rules/`). Agents that resolve `@`-imports load it via the line below; other agents must read that file directly.

@.agents/rules/superpowers-policy.md
