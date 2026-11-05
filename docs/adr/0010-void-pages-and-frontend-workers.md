# ADR 0010: render the frontends with Void pages, behind their own Workers

- **Status**: Accepted 2026-10-31. Supersedes the "server-rendered pages are not part of this decision" line of [ADR 0009](0009-void-and-solid.md). [ADR 0015](0015-preact-frontends.md) partly supersedes this ADR's renderer-specific decisions. Its Worker, cookie, loader, and gate timing contracts stand.
- **Scope**: `apps/dash`, `apps/app`, `apps/gate`, and the shared packages they import. `apps/api` does not change.

## Context

After ADR 0009, each frontend is a static Void SPA. A hand-written router in each app (`pushState` and `popstate`) picks the screen, the browser keeps the session token in `localStorage` and sends it to `api.fuda.sh` itself, and the Worker in front only serves files.

Void's pages mode (`@void/solid`) adds file-based routes in `pages/`, layouts, server loaders whose return value becomes the page's props, actions for mutations, and client navigation that fetches the next page's props from the Worker instead of reloading. Pages can opt out of server rendering one at a time with `export const ssr = false`. That handles the screens that need a wallet, a passkey or a camera, which exist only in the browser.

The api authenticates every protected route with an `Authorization: Bearer` session token, and keeps sessions in D1 (30 days). The token can therefore live anywhere that can attach the header.

A spike on 2026-10-31 (Void 1.4.0, `@void/solid` 1.4.0) confirmed the pieces:

- a Worker handler sets an HttpOnly cookie;
- middleware reads the cookie into the request context;
- a loader calls the api with the Bearer header, during server rendering and on client navigation;
- `ssr = false` pages render only in the browser;
- `Link` navigates without reloading.

## Decision

`dash` and `app` move to Void pages mode with Solid 1.9. `gate` gets the same Worker but stays a single-page app, as below.

- **Each frontend Worker is the browser's only backend.** The browser never holds an api token. The Worker keeps the session in an HttpOnly, `SameSite=Lax` cookie on its own host (`Secure` outside local development) and calls the api with `Authorization: Bearer`. The api, its sessions and its tests do not change.
- **Loaders read and a forwarding route writes.** A loader loads a page's initial data. The browser's other calls (saves, checks, uploads, the ENS claim steps, issue and revoke) go to a same-origin forwarding route, `/api/*`, in the frontend's Worker. It adds the Bearer header from the cookie and passes the api's response through. On an api 401 it also clears the cookie, so the client handles an expired session in one place. It refuses a write whose `Origin` is another site. Separate Worker routes under `/session/*` set or clear the cookie: sign-in, sign-out and entering the dashboard admin token. They are plain routes rather than Void actions, because the browser needs their result as data (did sign-in work, does the operator have a venue) before it navigates.
- **The api still sees the visitor's IP.** The api rate-limits by `CF-Connecting-IP`. A Worker's subrequest would otherwise arrive from the Worker, putting every visitor in one budget. The frontends and the api share the `fuda.sh` zone, and on a same-zone subrequest Cloudflare takes `CF-Connecting-IP` from `x-real-ip`, so each Worker sets `x-real-ip` to its own visitor's address and never passes the browser's. The shared server code for this lives in `@fuda/libs/worker`.
- **Sign-in still happens in the browser.** The wallet or passkey signs the api's challenge in an `ssr = false` page. The page then posts the signature to the Worker's session route, which calls `/auth/verify` or `/auth/member/verify` and sets the cookie. The page then navigates to the session's home.
- **The dashboard admin token is typed in, then kept in a cookie.** A session route stores it in an HttpOnly session cookie (no `Max-Age`) instead of tab memory. An empty token is a session too, for an api without `ADMIN_TOKEN`; the Worker then sends no `Authorization` header. The Worker never holds `ADMIN_TOKEN` as a secret, so the dashboard Worker gets no deployment credential of its own. Signing in as an operator clears the admin cookie, and entering the admin token clears the operator cookie.
- **Gate verification goes through its Worker, but the gate is not a pages app.** It has no session and no page worth rendering on the server, and a hardware reader types a scan as soon as the page is open. A pages app mounts only after the router has loaded the page component, so the first keystrokes would arrive before the scanner listens. The gate stays a Void single-page app rendered from `index.html` and adds one Worker route, the same `/api/*` forward, through which each scan reaches `/verify`.
- **Server-rendered and browser-only pages:**

  | App | Server-rendered | `ssr = false` |
  | --- | --- | --- |
  | dash | overview, rights, registration (`/start`), profile, card list and detail, passes | sign-in (`/signin`), issue, card designer and editor, reception |
  | app | top, `/@<handle>` venue and card pages | sign-in, rights list and settings (they read passes this device remembers), signed gate, +Private |
  | gate | (not a pages app) | the scanner, from `index.html` |

- **Route guards move to the Worker.** Which surface a route belongs to and where a signed-out or unregistered session is sent are decided in middleware, which redirects. A signed-out visit goes to the sign-in page, which now has its own URL. For an operator, the middleware reads `/issuers/me` on each page request and shares the venue and its cards with every page; a save re-reads it by refreshing the page's data in place. The pure helpers that make those decisions stay and keep their tests.
- **Theme and language preferences move to cookies.** They are not secrets, but the server needs them to render the right language and theme on the first response. Cookies replace `localStorage`, and middleware passes them to the pages as shared data.
- **The api origin stays server-side.** Each frontend defaults to `https://api.fuda.sh` in its Worker code. An explicit `API_BASE_URL` in the dev or deploy shell becomes an optional Worker variable through `void.config.ts`, instead of `VITE_API_BASE_URL`. The default needs no binding, so an existing static-assets-only Worker can migrate without adding variables during the first Void link. Browser-visible values that are not the api (the Graph endpoint, the ENS paymaster URL) stay `VITE_*` build values. Void reads no `.env.production` or `.env.example`, so they come from the deploy shell.

## Consequences

- **The hand-written routers go.** Navigation uses `Link` and `useRouter()`, and nested screens use `layout.tsx`. `@void/solid` 1.4.0's `useParams()` kept the first page's params after client navigation, so pages used `useRouter().params`. Void 1.6.2 includes the fix ([voidzero-dev/void#709](https://github.com/voidzero-dev/void/pull/709)). The dashboard card-detail page retains its working router params until the Preact rewrite.
- **Session plumbing in the browser goes.** Restoring a saved token, the token store in `@fuda/libs`, and the per-token generation checks in `dash` all existed because the browser held the token. A session change is now a navigation, so they are deleted. Guards that keep a late save from overwriting a newer one are unrelated and stay.
- **Every frontend runs a Worker.** Gate and dash stop being static-assets-only deployments. Local development and `pnpm e2e` start each frontend with `vp dev`. Two Void dev servers collide on the inspector port 9229, so the stack sets `VOID_INSPECTOR_PORT=false`.
- **A layout's context never reaches its page.** `@void/solid` creates the page before its layout, so state the member pages share (the pass-list query cache) is module state, not a layout provider.
- **`/@<handle>` pages are rewritten.** File routes cannot name a segment that starts with `@`, so the app's venue pages live under `pages/venue/` and middleware rewrites `/@<handle>/…` to them, leaving the browser's address alone. A static `routing.rewrites` rule would also catch Vite's own `/@id/` and `/@fs/` module URLs in development. A venue page renders its frame on the server; the Card itself appears once the browser has read what this device remembers.
- **Page-level flows lose their unit tests.** Components keep their tests, and the Worker's guard, forwarding and session code gain theirs. Wiring that now lives in `pages/` (such as a card draft surviving a trip to the profile) runs only under Void's router, so it is checked in a browser rather than by a unit test.
- **Browser calls to the api go away.** When all three frontends have moved, nothing calls the api from a browser except the api's own pages and the wallet's paymaster requests. So the api answers no CORS for fuda's own hosts.
- **The specs change with each app.** The session, preference and admin-token storage rules in `docs/specs/pass-types-and-flows.md` describe browser storage today. Each app's move updates the rules it changes.
- **Void and `@void/solid` upgrade together**, as ADR 0009 already noted. Void 1.4.0 was adopted inside the three-day `minimumReleaseAge` window through exact-version exemptions.
