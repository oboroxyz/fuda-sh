# Design: moving the frontends to Solid, with or without Void

- **Status**: Draft for approval, 2026-10-31. Nothing is implemented.
- **Scope**: `apps/app`, `apps/dash`, `apps/gate`, `packages/ui`. `apps/api` is listed as a later candidate only.

## Where we are now

All three frontends are client-only single-page apps. Each one mounts with `render()` from `hono/jsx/dom`, builds with Vite+ (`vp`) and deploys with Wrangler as a static-assets Worker on its own custom domain. `apps/app` also has a small Worker (`src/worker.ts`) because `/@<handle>` URLs must reach the SPA shell before Workers Static Assets rewrites the `@`.

| Package       | Component `.tsx` lines | `.test.tsx` lines | Plain `.ts` lines |
| ------------- | ---------------------: | ----------------: | ----------------: |
| `apps/app`    |                  3,275 |             2,769 |             1,841 |
| `apps/dash`   |                  5,979 |             6,515 |             3,606 |
| `apps/gate`   |                    158 |                 0 |               223 |
| `packages/ui` |                    473 |               278 |               186 |

Across these, components call `useState` 59 times, `useEffect` 53 times, `useRef` 33 times, `useCallback` 26 times and `use()` 4 times.

The view tests do not render to the DOM. They call a component as a function and walk the returned Hono VNode tree (`apps/dash/src/test/test-view.ts`: `tag`, `props`, `children`). They run in `environment: 'node'`.

`packages/ui/src/wallet-button.ts` is a `hono/html` string helper, and `apps/api/src/pass/PassPage.tsx` uses it to render the server pass page. That file has no dependency on Hono JSX.

## What the new frameworks are today

Checked on npm and in the `void@1.3.0` package docs (`node_modules/void/docs/`):

- **Void** (`void`, MIT, from VoidZero, now part of Cloudflare). It reached 1.0 on 2026-10-15 and ships a new minor every few days; 1.4.0 came out on 2026-10-30. The repo's `minimumReleaseAge` of 3 days means 1.3.0 is the newest version we can install today. `@void/solid` pins `void` to the same exact version, so the two always upgrade together.
  - A Void app can be API-only (`routes/`), a SPA with API routes, or server-rendered pages in `pages/` with loaders and actions. It also deploys plain static SPAs.
  - Deployment is `void deploy`, configured by `void.config.ts`, with a committed `void.lock.json`. A root `wrangler.jsonc` is migrated into that format, and the generated `.void-wrangler.jsonc` is kept out of Git.
  - Custom domains work (`custom_domain` routes). **Wrangler named environments do not**: each target needs its own Void project config.
  - The `void` package pulls in `better-sqlite3`, `mysql2`, `pg`, `miniflare`, `@cloudflare/vite-plugin`, `better-auth`, `drizzle-*` and more. Native builds need `allowBuilds` entries. Its `vite ^8` peer has to resolve through our `vite@*` → `@voidzero-dev/vite-plus-core@0.3.0` override; we have not tested that yet.
- **`@void/solid`** is Void's Solid adapter. It includes `vite-plugin-solid` and provides `Link`, `useForm`, layouts and islands. **It peers `solid-js ^1.9.0`.** The supported Void meta-frameworks are TanStack Start, React Router, SvelteKit, Nuxt, Analog and Astro. SolidStart is not on that list.
- **Solid**: `solid-js` 1.9.18 is the stable release. 2.0 is at `2.0.0-rc.20`, with breaking changes (`onMount` becomes `onSettled`, `createEffect` is split into two phases, `<Index>` becomes `<For keyed={false}>`, and Suspense and async are reworked). `@solidjs/router` is at 1.0.1, and `vite-plugin-solid` is at 2.11.15, with 3.0 still in `next`.
- **SolidStart** (`@solidjs/start`): 2.1.0 is stable and peers `solid-js ^1.9.15`.

Two consequences:

1. Void does not hide the Solid 1 → 2 difference today. Choosing Solid now means writing Solid 1.9 and migrating to 2.0 later, unless we wait for 2.0 to be stable and supported by `@void/solid`.
2. "Void + SolidStart" is not a combination. It is either `@void/solid` or SolidStart, but not both.

## Options

### A. Solid 1.9 SPA on the current Vite+ and Wrangler setup (no Void)

Replace `hono/jsx/dom` with `solid-js` through `vite-plugin-solid` in each app's `vite.config.ts`. Deployment, `wrangler.jsonc`, ports and the `apps/app` handle Worker stay as they are.

- Pros: the smallest change to the toolchain. We can roll it out one app at a time. Deployment risk is zero. Bundles get smaller and updates more precise, and Solid JSX uses `class`, like Hono does today.
- Cons: it is still a full component rewrite (see "Cost" below). Void is not adopted.

### B. Solid SPA plus Void as the build and deploy layer (Void "SPA + API" shape)

Same components as A, but each app becomes a Void project: `void.config.ts`, `void deploy`, and in `apps/app` a Void route in place of `src/worker.ts`.

- Pros: one deployment tool, which could later absorb `apps/api`. Rollback and logs come through `void project`.
- Cons: a 2-week-old 1.x dependency with a large, native-heavy dependency tree, sitting next to the Vite+ override. The deploy configuration moves out of `wrangler.jsonc`, so the runbook changes. Per-chain targets (ADR 0006) need one Void config per target once the frontends split by chain.

### C. Void pages mode with `@void/solid` (server-rendered pages)

Move routes into `pages/` with `.server.ts` loaders.

- Pros: real server rendering and loaders for public pages, such as the venue's `/@<handle>` home in `apps/app`.
- Cons: `dash` sits behind sign-in, and `gate` is a kiosk scanner. Server rendering does nothing for either. Wallet, passkey and scanner state exist only in the browser. This option also changes how the frontends get their data from `apps/api`, which is a much larger contract change.

### D. SolidStart without Void

- Pros: a stable 2.x meta-framework.
- Cons: the same server-rendering mismatch as C, without the Void deployment layer the request asked for.

## Cost common to every option

- **Components** (~9.9k lines): Solid runs a component body once and does not re-run it. `useState`/`useEffect`/`useRef`/`useCallback` become signals, effects and plain variables. Props must not be destructured, and conditional rendering moves to `<Show>`/`<For>`. That makes this a rewrite, not a search and replace, for about 175 hook call sites.
- **Tests** (~9.6k lines of `.test.tsx`): the VNode-walking harness cannot work, because Solid compiles JSX to real DOM nodes. View tests move to DOM assertions with `@solidjs/testing-library` and `happy-dom` (`happy-dom` is already a root dev dependency), and those projects switch away from `environment: 'node'`. Plain `.ts` logic and its tests, including copy, state and API helpers, stay as they are.
- **`packages/ui`**: its JSX components (`Scanner`, `ConfirmAction`, `IconButton`, `controls`, icons) move to Solid. `wallet-button.ts` stays a `hono/html` helper for `apps/api`, and the frontends wrap it or render their own Solid version. While apps migrate one at a time, `packages/ui` has to export both the Hono and the Solid components. A temporary second entry, such as `@fuda/ui/solid`, avoids a big-bang switch.
- **Lint**: the root oxlint and anti-slop policy assumes Hono JSX in places. A Solid-aware rule set (for example, no destructured props) needs checking against the root `vite.config.ts` policy.

## Recommendation

1. **Start with A, one app at a time, on Solid 1.9: `gate` → `dash` → `app`.** `gate` is about 380 lines with no view tests, so it proves the toolchain (`vite-plugin-solid` under Vite+, oxlint, the `happy-dom` test setup, and `packages/ui/solid`) cheaply. `dash` comes next because it has the most tests and no public surface. `app` goes last because it carries the handle Worker and the wallet and passkey flows.
2. **Treat Void as a separate, later decision.** Do not tie it to the Solid rewrite. Option B can be adopted per app after A without touching the components again. Option C makes sense only for the public `/@<handle>` pages, and only if we want them server-rendered. By then Void will have had a few more weeks to settle.
3. **On Solid 2:** if the rewrite will start after Solid 2 is stable, and `@void/solid` and `@solidjs/testing-library` support it, write 2.0 directly and skip the second migration. If we start now, the Solid 1.9 code must later migrate to 2.0. Expect that to be smaller than the Hono → Solid rewrite, but not free.

## Other candidates

- **`apps/api`**: Hono, Drizzle and D1 on Workers is exactly Void's API-only shape. Blockers we can see: named environments (`env.local`/`env.production`, ADR 0006) would need one Void config per target. `@cloudflare/vitest-pool-workers` tests would need checking under Void's runtime. The server-rendered `PassPage` must keep its byte-exact output. It is not in scope here.
- **`packages/libs`**: it uses `@tanstack/query-core`. TanStack Query has a Solid adapter (`@tanstack/solid-query`), which could replace the hand-wired query glue during the rewrite.

## Decisions (2026-10-31)

1. **Move each app onto Void, in this order: `gate` → `dash` → `app` → `apps/api`.** The frontends use the Void SPA shape with `@void/solid`, on Solid 1.9, which is what `@void/solid` supports. Moving to Solid 2.0 is a later migration.
2. **`apps/api` is in scope**, as a Void API-only app. Void has no Wrangler named environments, so each deployed target (develop/Sepolia, production/mainnet, and local) needs its own Void project config (ADR 0006). The api phase must settle how those configs stay in sync, and it must keep the `@cloudflare/vitest-pool-workers` suite and the byte-exact `PassPage` output.
3. **Phase 1 adds a browser end-to-end suite on the `e2e` package** before any framework change. The repository has no Playwright tests to port. The suite uses locator steps only (no model) and runs against the real local stack, so it covers the api phase as well. Plan: `.superpowers/plans/2026-10-31-e2e-suite.md`.

Each later phase gets its own plan after the previous phase lands.
