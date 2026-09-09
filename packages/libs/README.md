# `@fuda/libs`

Shared library integrations, exposed through independent subpaths. Import only the integration you need;
there is no root barrel export. Browser and backend integrations can coexist here, with runtime-specific
dependencies kept behind their own entry points. Reconsider separate packages if their dependency or
deployment requirements diverge.

## `@fuda/libs/query`

Shared in-memory read caching for fuda's Hono JSX applications. The package is a small adapter around
TanStack Query Core; its results and cache remain Query Core's rather than a second state model.

### API

- `createQueryClient()` creates an independent client. Read data stays fresh for 30 seconds. Failed reads
  retry once unless the error has a 4xx status. Mutations do not retry.
- `useQueryScope()` creates one client for a mounted component, enables focus and reconnect handling, and
  clears and unmounts the client when that component is removed.
- `useQuery(client, options)` observes a query from Hono JSX DOM. The client is explicit so ownership and
  protected-data boundaries stay visible. It returns Query Core's `QueryObserverResult`.
- `readQueryResult(result)` unwraps a successful `@fuda/sdk/http` result. A failed result throws
  `QueryError`, which exposes `status` and `network`.

`QueryOptions<T>`, `QueryClient`, `QueryKey`, and `QueryObserverResult` are exported for consumers. The
adapter supports Query Core observer options, including `enabled`, `initialData`, `staleTime`, `retry`,
`refetchInterval`, focus and reconnect policies, and imperative `refetch` through the returned result. It
does not provide Suspense or error-boundary integration.

### Hono JSX DOM

```tsx
/** @jsxImportSource hono/jsx/dom */
import { readQueryResult, useQuery, useQueryScope } from '@fuda/libs/query'

const Passes = () => {
  const client = useQueryScope()
  const passes = useQuery(client, {
    queryKey: ['passes', apiEndpoint, holderAddresses],
    queryFn: async ({ signal }) => readQueryResult(await loadPasses({ signal })),
    refetchInterval: 30_000,
  })

  if (passes.isPending) return <p>Loading…</p>
  if (passes.isError) return <p>{passes.error.message}</p>
  return <PassList passes={passes.data} />
}
```

Use query keys for every input that changes the identity of returned data. Do not put session tokens,
signing keys, PRF output, wallet credentials, or authentication UI state in query keys or cached result
data. Clear or replace a scope when its authorization boundary changes. Write workflows remain explicit; after a successful write,
update or invalidate the affected read query through the client.

## `@fuda/libs/wallet`

`baseAccountProvider({ appChainIds, appName?, paymasterUrls? })` lazily loads Base Account.
The caller selects chains and sponsorship; member entry and venue ENS claims use different configuration.
`requestAccount` validates and checksums the account, and `personalSign` validates the returned signature.
`injectedProvider` reads an optional browser wallet. All providers implement `Eip1193Provider`.

## `@fuda/libs/auth`

`authenticateWallet(io, signal?)` runs account selection, server challenge, personal signature and verification,
returning the caller's verified session or a wallet/network/rejected/unavailable failure. Product-specific
reads and navigation stay with the caller. Aborting stops subsequent prompts and requests after the
current step settles; controllers still invalidate their UI immediately and discard stale work. It does
not cancel an already submitted wallet operation or HTTP request.

`createTokenStore({ apiBaseUrl, audience, storage? })` isolates member and operator tokens by API origin.
Its `clear(token)` removes only that token, preserving a newer replacement. Blocked browser storage does
not prevent an in-memory session. `createSessionGeneration()` lets controllers invalidate outstanding
async work; check captured tickets before installing a result or changing a replacement session.
