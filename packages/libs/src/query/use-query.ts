import { QueryObserver } from '@tanstack/query-core'
import type { QueryClient, QueryObserverOptions, QueryObserverResult } from '@tanstack/query-core'
import { useEffect, useRef, useState } from 'hono/jsx/dom'

import { createQueryClient } from './client.ts'

export type QueryOptions<T> = QueryObserverOptions<T, Error, T, T>

interface ObserverState<T> {
  client: QueryClient
  observer: QueryObserver<T, Error, T, T>
}

export const useQueryScope = (): QueryClient => {
  const [client] = useState(createQueryClient)

  useEffect(() => {
    client.mount()
    return () => {
      client.clear()
      client.unmount()
    }
  }, [client])

  return client
}

export const useQuery = <T>(client: QueryClient, options: QueryOptions<T>): QueryObserverResult<T> => {
  const defaultedOptions = client.defaultQueryOptions<T, Error, T, T>({
    ...options,
    _optimisticResults: 'optimistic',
  })
  const observerState = useRef<ObserverState<T> | null>(null)

  if (!observerState.current || observerState.current.client !== client) {
    observerState.current?.observer.destroy()
    observerState.current = {
      client,
      observer: new QueryObserver<T, Error, T, T>(client, defaultedOptions),
    }
  }

  const { observer } = observerState.current
  const result = observer.getOptimisticResult(defaultedOptions)
  const [, setVersion] = useState(0)

  useEffect(
    () =>
      observer.subscribe(() => {
        setVersion((version) => version + 1)
      }),
    [observer],
  )
  useEffect(() => {
    observer.setOptions(defaultedOptions)
  }, [defaultedOptions, observer])

  return result
}
