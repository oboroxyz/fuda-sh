# Member app

A Preact application served by its own Void Worker through the exact adapter versions in [ADR 0015](../../docs/adr/0015-preact-frontends.md). Public venue routes under `/@handle` render a frame and metadata on the server, then read the device's saved cards in the browser. The member top is server-rendered. Sign-in, rights, settings and signed entry are browser-only pages.

Run `pnpm dev:app-api` at the repository root for local development. The app owns port 5173. Root `pnpm check`, `pnpm test`, `pnpm fallow:audit` and `pnpm e2e` check the workspace. The unchanged app e2e cases run with `pnpm e2e app`.

`@fuda/libs/query-preact` owns read observers. App controllers own event-driven passkey and claim workflows. The opened Sensitive secret stays in the mounted list's state and is cleared on unmount. Its pure cryptographic and vault functions remain in `src/member/`. Sign-out ends the session and leaves the document to discard its member cache and mounted state.

App and dash share preference lifetimes, stable callbacks, and pages/test configuration through `@fuda/ui-preact`. They keep their own cookie names, prebundled dependencies and ports. The development-only preview uses lazy/Suspense; the wallet rail is imported inside its user event so chunk failures become a REJECT verdict.
