import type { Result } from '@fuda/sdk/http'
import { QueryClient } from '@tanstack/query-core'

const FRESH_FOR_MS = 30_000

export class QueryError extends Error {
  readonly network: boolean
  readonly status: number

  constructor(message: string, status: number, network: boolean) {
    super(message)
    this.name = 'QueryError'
    this.network = network
    this.status = status
  }
}

const retryTransientRead = (failureCount: number, error: Error): boolean => {
  if (error instanceof QueryError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < 1
}

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: retryTransientRead, staleTime: FRESH_FOR_MS },
    },
  })

export const readQueryResult = <T>(result: Result<T>): T => {
  if (result.ok) {
    return result.body
  }
  throw new QueryError(result.error, result.status, result.network)
}
