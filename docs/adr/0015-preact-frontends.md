# ADR 0015: Preact frontends through void-preact

- **Status**: Accepted 2026-11-05. The migration is built. Gate, dash and app use Preact; the previous renderer and temporary package names are removed. Deployment and real-device checks remain. Replaces the Solid renderer decision in [ADR 0009](0009-void-and-solid.md) and the renderer-specific parts of [ADR 0010](0010-void-pages-and-frontend-workers.md). Their Worker, cookie, loader, and gate timing contracts stand.
- **Scope**: `apps/gate`, `apps/dash`, `apps/app`, and their renderer-specific shared UI and query bindings. The API remains on Void with its existing server rendering.

## Context

The owner chose Preact through their own `void-preact` adapter because they consider it the most promising structure and want fuda to dogfood their library. This is an owner preference, not a measured performance advantage over Solid.

The adapter's [README](https://github.com/yujiym/void-preact#readme) recommends dogfooding only and asks users to avoid production use. It is unofficial, uses Void's adapter-facing entries and private Preact Suspense behavior, and follows a rapidly changing framework. The owner accepts that risk for fuda.

A local spike on 2026-11-05 tested published `void-preact@0.1.2` with Void 1.6.2, Preact 11.1.1, and `preact-render-to-string` 6.8.2. It kept the dashboard Worker and session plumbing but served only bounded profile and card-detail pages. The original dashboard pages remained outside routing, so the spike was not a landable dashboard conversion.

## Decisions

### 1. Plain Preact hooks

Move the three frontends to Preact through `void-preact`. Use plain hooks without `@preact/signals`. Use refs for component lifetimes, request generations, and immediate busy guards. Preserve cancellation, teardown, synchronous draft publication, and rejection of late results explicitly. Preact reruns component bodies, so Solid's component-owned closures cannot be translated by renaming APIs.

### 2. Migrate one frontend at a time

Keep every existing route available in each landable change. Migrate gate, then dash, then app, and finally remove Solid and the temporary migration names.

The migration used a temporary Preact UI package while consumers moved. The surviving implementation is now the canonical `@fuda/ui` in `packages/ui`. Renderer-independent helpers remain on their existing subpaths. The API's `/wallet-button` stays a Hono HTML helper; `/wallet-view` contains the Preact component and keeps Wallet artwork out of unrelated routes.

`@fuda/libs/query` now exposes the Preact hooks over the renderer-independent Query Core client. The earlier query binding is removed. Query-key, subscription and cleanup behavior remains covered by the member app's tests.

### 3. Keep the Worker and timing contracts

Dash and app remain Void pages apps with server loaders and browser-only pages where browser capabilities are required. Their Workers keep credentials in HttpOnly cookies, validate sessions, and forward same-origin API calls. Session changes must still discard protected drafts and prevent stale pages from writing under a different session. Theme and language cookies still determine the initial server response.

Gate remains a directly mounted SPA from `index.html`, with verification through its Worker. Install its hardware-reader listener with layout-effect timing. Router loading must not delay that listener. Preserve the camera's late-stream cleanup and the same-tick duplicate-scan guard.

The renderer change does not amend the product or protocol contracts in the canonical specs. Keep the `packages/e2e` assertions unchanged as the migration safety net.

### 4. Pin the supported combination

Use exact pins for `void-preact@0.1.3`, `void@1.7.0`, `preact@11.1.1`, and `preact-render-to-string@6.8.2`. Use the published adapter package, with no workspace link.

A Void upgrade now waits for an adapter release that supports the new exact version. Recheck the adapter's private Suspense contract when changing the Preact pair. Keep the existing three-day release-age policy, with exact package-version exemptions when adopting a release inside that window. The tested Vite+ 0.3.0 toolchain stays unchanged by this decision.

## Relation to earlier decisions

- [ADR 0009](0009-void-and-solid.md) no longer chooses Solid 1.9, a Solid-only shared UI, or a future Solid 2 migration. Its Void Worker, API target, deployment, database, and secret decisions stand.
- [ADR 0010](0010-void-pages-and-frontend-workers.md) no longer chooses `@void/solid` or its renderer-specific context arrangement as the target architecture. Its Worker boundaries, cookies, loaders, forwarding routes, guards, and gate mount timing stand. The Preact implementation preserves the session and data lifetimes those arrangements protected.

## Measurements

The spike's bounded pages passed SSR, hydration, cookie-driven shared-data refresh, same-document navigation, current route params, and ordinary root-layout state preservation. Three clean-cache development starts each passed five direct HTTP requests and five Chromium document visits. A built local Worker passed five of each. No adapter blocker was reproduced in those cases.

The bounded profile page's static client dependency closure was 24,032 bytes gzipped with Preact and 22,484 with Solid, an increase of 1,548 bytes, about 1.5 KB. Card detail increased by 1,648 bytes. The script followed static imports from each production client manifest, deduplicated chunks, and gzipped each response separately at level 9. It excluded CSS, server code, other routes, and untriggered dynamic imports. Five repetitions gave identical counts, and repeat builds gave identical client output.

The final migration builds every route and compares against main's production output at `b6dd35e39cb234d8e899f9e6d0a20d03cdba2f9c`. Both builds use Vite+ 0.3.0 with the same local API base, app origin and relying-party ID. Each route counts the pages runtime, its page and applicable layouts, following static imports and counting each JS response once. App routes contain 468 to 3,318 fewer gzipped bytes; dash routes contain 52 to 65 more; gate startup contains one more. Five alternating compressions agree exactly.

| Whole app  | Main gzip bytes | Preact gzip bytes | Difference |
| ---------- | --------------: | ----------------: | ---------: |
| Member app |         420,038 |           408,665 |    -11,373 |
| Dashboard  |         320,668 |           320,680 |        +12 |
| Gate       |          59,165 |            59,167 |         +2 |

Whole-app totals count every emitted client JS file once, including lazy routes, the camera decoder and wallet chunks. They are not sums of route totals, which share chunks. CSS, source maps, fonts, server output and network timing are excluded. Embedded Wallet artwork counts because it ships in JS. A separate WalletButton entry keeps that artwork on venue routes. Chunking and compression bound these byte counts; they do not isolate renderer runtime size or establish CPU, latency or hydration speed.

## Consequences

- All three frontends share one Preact UI implementation. The temporary renderer packages and the previous renderer's compiler branches are removed.
- The owner accepts an adapter whose own documentation advises against production use. Exact pins constrain upgrades but do not prove correctness.
- The dash move ported every dashboard route and checked each in Chromium, in both languages, in development and on the built Worker, with a virtual authenticator for passkey sign-in and for adding a second passkey. A real device's authenticator, a real wallet sign-in and an ENS claim on a live chain remain owner checks. A real camera and hardware reader are still unverified under Preact.
- Draft publication before navigation and session-version replacement with preserved route state are proven in dash by DOM tests and in the browser. The app's query binding has behavior tests for changed keys without a stale render, disabled queries, cancellation, refetch, focus and reconnect, unmount and independent owners.
- A component that reads a function prop in an effect dependency list reruns that effect whenever its parent hands it a new function. Solid ran such effects once, because props were lazy getters. Dash therefore gives its pages stable callbacks and caches the guarded API wrappers. A function stored with `useState` must be wrapped, because Preact calls a function argument as a lazy initializer.
- The app keeps the wallet rail behind an event-time dynamic import so a failed chunk fetch becomes the existing REJECT verdict. The development preview uses Preact lazy and Suspense. Suspended route layout resets, deferred loaders, actions and forms, islands, and deeper nested layouts remain unverified.
- The completed migration passes `pnpm check`, `pnpm test`, `pnpm fallow:audit` and all 19 unchanged E2E cases. Fallow finds no dead code or clones with no duplicate exclusions. All three production Workers build and run locally; a short Chromium pass checks app navigation, dash appearance and gate keyboard rejection. These local checks do not establish real-device or live-service parity.

Each completed migration layer must pass `pnpm check`, `pnpm test`, `pnpm fallow:audit`, and the full unchanged `pnpm e2e`. Owner checks after deploy include camera permission and teardown, hardware-reader timing, real passkey cancellation and PRF recovery across devices, wallet sign-in and Wallet saves, Turnstile, live-chain entry and ENS claims. Safari/WebKit and Firefox remain unverified.
