# AGENTS.md

Guidance for AI coding agents in this repository.

@.agents/rules/workflow-policy.md

## Repository

**fuda** is a pnpm monorepo. `apps/*` are deployable Cloudflare Workers, and direct children of `packages/*` with a `package.json` are shared packages. Projects nested under `packages/subgraphs/` and `packages/substreams/` build on their own, outside the workspace.

Before changing product behavior or a protocol, read the relevant [specification](docs/specs/README.md). Use [the glossary](docs/CONTEXT.md) for domain terms. Setup and deployment live in [the runbook](docs/runbook.md).

Before changing frontend UI or styling under `apps/app`, `apps/dash`, `apps/gate`, `packages/ui` or `packages/styles`, read `.agents/rules/frontend-design.md`.

## Toolchain

Vite+ (`vp`) drives builds, tests, linting and formatting. Package `vite.config.ts` files configure each app. The root one holds shared lint and format policy, and its comments record the exceptions. Database work uses `void db`.

- Use the root `package.json` scripts: `pnpm check`, `pnpm test`, `pnpm fallow:audit`, `pnpm e2e`. Install with `pnpm install --frozen-lockfile`.
- `pnpm e2e` rewrites `apps/*/void.lock.json` with local values. Restore them afterwards and never commit the result. It uses fixed ports, so run one at a time.
- Keep lint strict. Suppress a rule only on the narrowest line, with the reason: `// oxlint-disable-next-line <rule> -- <why>`.
- Fallow fails a pull request on the unused code, duplication and complexity it introduces. Before deleting code it calls unused, confirm with `pnpm exec fallow dead-code --trace <file>:<export>` or `--trace-dependency <name>`. When Void adds a file-routed directory, add it to `entry` in `.fallowrc.json`.
- Upgrade Vite+ together with its `oxlint`, `oxfmt` and `vite-plus-core` overrides in `pnpm-workspace.yaml`.

All three frontends use Preact. Shared components and page tooling live in `@fuda/ui`; `@fuda/libs/query` exposes the Preact query hooks. Keep the API's `@fuda/ui/wallet-button` Hono HTML helper independent of the frontend renderer.

When changing frontend UI or styling under `apps/app`, `apps/dash`, `apps/gate`, `packages/ui`, or `packages/styles`, read `.agents/rules/frontend-design.md` before editing.

## Evidence

Save screenshots, recordings and review evidence under `artifacts/<YYYY-MM-DD>-<task>/`, which is Git-ignored. Use `/tmp` for disposable scripts and logs. Builds and tests must not depend on either. When handing off a capture, give its absolute path, viewport, locale, theme and any fictional data.

## D1 writes

Batch a variable-length, multi-row D1 statement below D1's limit of 100 bound parameters per statement.
