// Solid bindings for the shared TanStack Query client, the counterpart of
// use-query.ts for apps that have moved to Solid (docs/adr/0009-void-and-solid.md).
// Remove use-query.ts once no app imports it.
import { QueryObserver } from '@tanstack/query-core'
import type { DefaultedQueryObserverOptions, QueryClient, QueryObserverResult } from '@tanstack/query-core'
import { createComputed, createSignal, on, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

import { createQueryClient } from './client.ts'
import type { QueryOptions } from './use-query.ts'

// One client per owner (an app root or a screen), mounted for the owner's
// lifetime. Teardown aborts in-flight requests and drops the cache.
export const createQueryScope = (): QueryClient => {
  const client = createQueryClient()
  client.mount()
  onCleanup(() => {
    client.clear()
    client.unmount()
  })
  return client
}

// `options` is read reactively: a changed key or `enabled` flag updates the
// observer, and the result accessor switches to the new key's state at once.
export const createQuery = <T>(
  client: QueryClient,
  options: () => QueryOptions<T>,
): Accessor<QueryObserverResult<T>> => {
  const defaulted = (): DefaultedQueryObserverOptions<T, Error, T, T> =>
    client.defaultQueryOptions<T, Error, T, T>({ ...options(), _optimisticResults: 'optimistic' })
  const observer = new QueryObserver<T, Error, T, T>(client, defaulted())
  const [result, setResult] = createSignal(observer.getOptimisticResult(defaulted()), { equals: false })
  const unsubscribe = observer.subscribe((next) => {
    setResult(() => next)
  })
  createComputed(
    on(
      defaulted,
      (next) => {
        observer.setOptions(next)
        setResult(() => observer.getOptimisticResult(next))
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    unsubscribe()
    observer.destroy()
  })
  return result
}
