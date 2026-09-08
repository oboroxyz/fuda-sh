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
