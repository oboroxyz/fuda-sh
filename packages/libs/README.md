# `@fuda/libs`

Shared library integrations, exposed through independent subpaths. Import only the integration you need; there is no root barrel export. Browser and backend integrations can coexist here, with runtime-specific dependencies kept behind their own entry points. Reconsider separate packages if their dependency or deployment requirements diverge.

## `@fuda/libs/query`

Shared in-memory read caching for fuda's Solid applications. The package is a small adapter around TanStack Query Core; its results and cache remain Query Core's rather than a second state model.

### API

- `createQueryClient()` creates an independent client. Read data stays fresh for 30 seconds. Failed reads retry once unless the error has a 4xx status. Mutations do not retry.
- `createQueryScope()` creates one client for the current Solid owner, enables focus and reconnect handling, and clears and unmounts the client when that owner is disposed.
- `createQuery(client, options)` observes a query. `options` is a function, so the observer follows the signals it reads. The client is explicit so ownership and protected-data boundaries stay visible. It returns an accessor of Query Core's `QueryObserverResult`.
- `readQueryResult(result)` unwraps a successful `@fuda/sdk/http` result. A failed result throws `QueryError`, which exposes `status` and `network`.

`QueryOptions<T>`, `QueryClient`, `QueryKey`, and `QueryObserverResult` are exported for consumers. The adapter supports Query Core observer options, including `enabled`, `initialData`, `staleTime`, `retry`, `refetchInterval`, focus and reconnect policies, and imperative `refetch` through the returned result. It does not provide Suspense or error-boundary integration.

### Solid

```tsx
import { createQuery, createQueryScope, readQueryResult } from '@fuda/libs/query'
import { Match, Switch } from 'solid-js'

const Passes = () => {
  const client = createQueryScope()
  const passes = createQuery(client, () => ({
    queryKey: ['passes', apiEndpoint, holderAddresses()],
    queryFn: async ({ signal }) => readQueryResult(await loadPasses({ signal })),
    refetchInterval: 30_000,
  }))

  return (
    <Switch fallback={<p>Loading…</p>}>
      <Match when={passes().isError}>
        <p>{passes().error?.message}</p>
      </Match>
      <Match when={passes().data}>{(data) => <PassList passes={data()} />}</Match>
    </Switch>
  )
}
```

Use query keys for every input that changes the identity of returned data. Do not put session tokens, signing keys, PRF output, wallet credentials, or authentication UI state in query keys or cached result data. Clear or replace a scope when its authorization boundary changes. Write workflows remain explicit; after a successful write, update or invalidate the affected read query through the client.

## `@fuda/libs/wallet`

`baseAccountProvider({ appChainIds, appName?, paymasterUrls? })` lazily loads Base Account. The caller selects chains and sponsorship; member entry and venue ENS claims use different configuration. `requestAccount` validates and checksums the account, and `personalSign` validates the returned signature. `injectedProvider` reads an optional browser wallet. All providers implement `Eip1193Provider`.

## `@fuda/libs/auth`

`authenticateWallet(io, signal?)` runs account selection, server challenge, personal signature and verification, returning the caller's verified session or a wallet/network/rejected/unavailable failure. Product-specific reads and navigation stay with the caller. Aborting stops subsequent prompts and requests after the current step settles; controllers still invalidate their UI immediately and discard stale work. It does not cancel an already submitted wallet operation or HTTP request.

`passkeyClient(audience, transport)` runs the WebAuthn ceremonies for `member` or `operator`: sign in, create an account, and list, add and remove passkeys. `transport` is how that frontend reaches the api and its own session route. `cancelPasskeyCeremony()` dismisses a running prompt.

Session tokens never reach the browser: each frontend's Worker keeps them in an HttpOnly cookie (`@fuda/libs/worker`).

## `@fuda/libs/worker`

The server half every frontend Worker shares ([ADR 0010](../../docs/adr/0010-void-pages-and-frontend-workers.md)). `forwardToApi(c, { apiBaseUrl, token, expireOnUnauthorized, prefix? })` answers the browser's same-origin `/api/*` call as the api would, adding the session's `Authorization: Bearer` and dropping any credential the browser sent; an api 401 to a credential expires the named session cookies. `apiHeaders(c, token)` builds the same headers for a Worker's own api calls. Both set `x-real-ip` to the visitor's address, because the api rate-limits by `CF-Connecting-IP` and a same-zone subrequest takes it from `x-real-ip`; without it every visitor would share the Worker's budget. `crossOriginWrite(c)` refuses a non-GET request whose `Origin` is another site; every route that sets a session cookie calls it, or any page could sign the browser in to an account of its choosing. `setSessionCookie`, `clearCookie` and `readCookie` keep the cookies HttpOnly, `SameSite=Lax` and `Secure` outside plain-http development.
