# ADR 0009: move the apps onto Void, with Solid for the frontends

- **Status**: Accepted 2026-10-31. Every app has moved: `gate`, `dash` and `app` are Solid 1.9 Void static SPAs, and `apps/api` is a Void app with one project per target. None has been deployed with Void yet. [ADR 0010](0010-void-pages-and-frontend-workers.md) supersedes the decision below not to server-render the frontends. [ADR 0012](0012-void-api-routing.md) supersedes the API middleware bridge with native Void server routing. The browser end-to-end suite (`packages/e2e`, `pnpm e2e`) is the safety net.
- **Scope**: `apps/gate`, `apps/dash`, `apps/app`, `packages/ui` and `apps/api`.

## Context

All three frontends are client-only single-page apps. They render with `hono/jsx/dom`, build with Vite+ (`vp`), and deploy with Wrangler as static-assets Workers on their own custom domains. `apps/app` also has a small Worker that sends `/@<handle>` URLs to the SPA shell. `apps/api` is Hono, Drizzle and D1 on Workers, with one Wrangler named environment per chain ([ADR 0006](0006-per-chain-environments.md)).

Void (`void`, from VoidZero, now part of Cloudflare) builds and deploys Vite apps to Workers. It reached 1.0 on 2026-10-15 and supports API-only apps, SPAs with API routes, and server-rendered pages. Its Solid adapter, `@void/solid`, requires `solid-js ^1.9`. Solid 2.0 was still a release candidate as of 2026-10-31. SolidStart is not one of the frameworks Void supports.

## Decision

Move each app onto Void, one at a time, in this order: `gate`, `dash`, `app`, then `apps/api`.

- The frontends become Void SPAs on Solid 1.9. Server-rendered pages are not part of this decision: wallet, passkey and scanner state exist only in the browser, `dash` sits behind sign-in, and `gate` is a kiosk.
- An SPA compiles Solid with `vite-plugin-solid` directly. `@void/solid` builds Void's server-rendered pages, so it is added only if an app later adopts pages mode, for example for the public `/@<handle>` pages.
- `apps/api` becomes a Void API-only app that keeps its Hono app. A single Void middleware hands every request to the existing Worker entry, so the routes, the tests and the server-rendered `PassPage` do not change.
- SolidStart is not used, because Void does not support it.

`gate` goes first because it is small and has no view tests, so it proves the toolchain cheaply. `app` goes last among the frontends because it carries the handle Worker and the wallet and passkey flows.

## Consequences

- **The rewrite is real work.** About 9.9k lines of components and about 175 hook call sites need a manual rewrite, because Solid runs a component body once. About 9.6k lines of view tests walk Hono VNodes and must become DOM tests (`@solidjs/testing-library` with `happy-dom`). Plain `.ts` logic and its tests stay.
- **Shared packages are Solid-only.** Once every frontend moved, the Hono components and query hooks were deleted. `@fuda/ui` exports Solid components and `@fuda/libs/query` exports the Solid query bindings (`createQuery`, `createQueryScope`). Renderer-independent helpers have their own subpaths, such as `@fuda/ui/short`. `@fuda/ui/wallet-button` stays a `hono/html` helper, because `apps/api` renders it on the server.
- **Solid 2.0 is a second migration.** Choosing Solid 1.9 now means moving to 2.0 later, once it is stable and `vite-plugin-solid` supports it.
- **Deployment moves out of `wrangler.jsonc`.** It moves to `void.config.ts` and a committed `void.lock.json`. Void has no named environments, `void deploy` has no `--project` flag for Cloudflare, and `sourceDir` must stay inside the project. So each api target (`local`, `develop`, `production`) is its own Void project under `apps/api/targets/<name>/`, holding only a one-line `void.config.ts`, a Vite config, a one-line middleware re-export and, once deployed, its lock file.
- **One file holds the api targets.** `apps/api/targets.jsonc` keeps each target's Worker name, routes, D1 and R2 bindings and `vars`, and `apps/api/targets.ts` builds each project's config from it. It is JSONC rather than TypeScript because the rights subgraph's `graph:prepare` reads the `develop` vars from it as an independent package. The workerd test pool takes its bindings from the same file, so the suite no longer reads a Wrangler config.
- **Database commands use Void.** The api keeps hand-written SQL in `apps/api/migrations`, shared into each target through `db/migrations` symlinks. `inference.bindings.db` stays off so deploy does not infer schemas or apply SQL automatically. Explicit `void db migrate` commands apply the history; direct Cloudflare operations keep `d1_migrations`. A compatibility patch adopts that legacy history locally into `_void_migrations` and resolves the configured D1 ID before opening the local database, preserving the dev server's data. Destructive historical SQL has explicit approval pragmas; no executable SQL or applied filename changes.
- **Secrets stay Worker secrets.** `void secret put` and `void secret sync` manage secrets on the selected Cloudflare target. There is no inferred auth or env schema; local values stay in `targets/local/.env`.
- **Wrangler is limited to the browser test harness.** `packages/e2e` owns the dependency because its built-Worker runtime relies on an explicit environment file and isolated persistence. Migrating it to a Void server requires equivalent isolation before the dependency can disappear entirely.
- **Upgrades come in pairs.** Void releases new versions every few days and pulls in a large dependency tree, including native modules. The repository's 3-day `minimumReleaseAge` limits which versions we can install, and `void` and `@void/solid` (if adopted) must upgrade together, because the adapter requires the exact same `void` version.
- **The browser suite is the safety net.** It must pass unchanged before and after each phase. It asserts on roles and visible text only, so a framework change does not touch it.
