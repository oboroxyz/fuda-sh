import { QueryObserver } from '@tanstack/query-core'
import type { QueryClient, QueryObserverOptions, QueryObserverResult } from '@tanstack/query-core'
import { useSyncExternalStore } from 'preact/compat'
import { useCallback, useLayoutEffect, useState } from 'preact/hooks'

import { createQueryClient } from './client.ts'

export { createQueryClient, QueryError, readQueryResult } from './client.ts'
export type { QueryClient, QueryKey, QueryObserverResult } from '@tanstack/query-core'
export type QueryOptions<T> = QueryObserverOptions<T, Error, T, T>

export const useQueryScope = (): QueryClient => {
  const [client] = useState(createQueryClient)
  useLayoutEffect(() => {
    client.mount()
    return () => {
      client.clear()
      client.unmount()
    }
  }, [client])
  return client
}

export const useQuery = <T>(client: QueryClient, options: QueryOptions<T>): QueryObserverResult<T> => {
  const defaulted = client.defaultQueryOptions<T, Error, T, T>({
    ...options,
    _optimisticResults: 'optimistic',
  })
  const [observer] = useState(() => new QueryObserver<T, Error, T, T>(client, defaulted))
  const optimistic = observer.getOptimisticResult(defaulted)
  const subscribe = useCallback(
    (changed: () => void) => {
      const unsubscribe = observer.subscribe(changed)
      observer.updateResult()
      return unsubscribe
    },
    [observer],
  )
  useSyncExternalStore(
    subscribe,
    () => observer.getCurrentResult(),
    () => optimistic,
  )
  useLayoutEffect(() => {
    observer.setOptions(defaulted)
  }, [defaulted, observer])
  return optimistic
}
