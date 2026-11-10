# `@fuda/libs`

Shared library integrations, exposed through independent subpaths. Import only the integration you need; there is no root barrel export. Browser and backend integrations can coexist here, with runtime-specific dependencies kept behind their own entry points. Reconsider separate packages if their dependency or deployment requirements diverge.

## `@fuda/libs/query`

Shared in-memory read caching for Preact uses TanStack Query Core. Its results and cache remain Query Core's rather than a second state model. `useQueryScope()` creates one client lazily, mounts it for focus and reconnect handling, and clears and unmounts it with its component. `useQuery(client, options)` accepts an options object and returns the current `QueryObserverResult`, including `refetch`.

One lazy observer belongs to each hook. Its external-store subscription survives rerenders, and optimistic results switch keys in the render that receives the new options. A key change never displays the previous key's result. Unsubscribing cancels a request when no other observer needs it and the query function consumes its AbortSignal. Independent scopes never share a cache. SSR does not subscribe, mount a client or start a query request.

Use `createQueryClient` when the caller needs an explicit cache lifetime. Keep signing keys, member secrets, PRF output and vault contents out of query state.

`readQueryResult(result)` unwraps a successful SDK result and throws `QueryError` with `status` and `network` on failure.

`createQueryClient()` keeps reads fresh for 30 seconds and retries failed reads once unless the error has a 4xx status. Mutations do not retry. Query keys must include every input that changes the returned data, and must exclude session tokens and credentials. Clear or replace a scope when its authorization boundary changes. Writes remain explicit and update or invalidate the affected read query after success.

## `@fuda/libs/wallet`

`baseAccountProvider({ appChainIds, appName?, paymasterUrls? })` lazily loads Base Account. The caller selects chains and sponsorship; member entry and venue ENS claims use different configuration. `requestAccount` validates and checksums the account, and `personalSign` validates the returned signature. `injectedProvider` reads an optional browser wallet. All providers implement `Eip1193Provider`.

## `@fuda/libs/auth`

`authenticateWallet(io, signal?)` runs account selection, server challenge, personal signature and verification, returning the caller's verified session or a wallet/network/rejected/unavailable failure. Product-specific reads and navigation stay with the caller. Aborting stops subsequent prompts and requests after the current step settles; controllers still invalidate their UI immediately and discard stale work. It does not cancel an already submitted wallet operation or HTTP request.

`passkeyClient(audience, transport)` runs the WebAuthn ceremonies for `member` or `operator`: sign in, create an account, and list, add and remove passkeys. `transport` is how that frontend reaches the api and its own session route. `cancelPasskeyCeremony()` dismisses a running prompt.

Session tokens never reach the browser: each frontend's Worker keeps them in an HttpOnly cookie (`@fuda/libs/worker`).

## `@fuda/libs/worker`

The server half every frontend Worker shares ([Frontend Workers](../../docs/architecture.md#frontend-workers)). `forwardToApi(c, { apiBaseUrl, token, expireOnUnauthorized, prefix? })` answers the browser's same-origin `/api/*` call as the api would, adding the session's `Authorization: Bearer` and dropping any credential the browser sent; an api 401 to a credential expires the named session cookies. `apiHeaders(c, token)` builds the same headers for a Worker's own api calls. Both set `x-real-ip` to the visitor's address, because the api rate-limits by `CF-Connecting-IP` and a same-zone subrequest takes it from `x-real-ip`; without it every visitor would share the Worker's budget. `crossOriginWrite(c)` refuses a non-GET request whose `Origin` is another site; every route that sets a session cookie calls it, or any page could sign the browser in to an account of its choosing. `setSessionCookie`, `clearCookie` and `readCookie` keep the cookies HttpOnly, `SameSite=Lax` and `Secure` outside plain-http development.
