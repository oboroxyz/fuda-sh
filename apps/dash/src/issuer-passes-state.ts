import type { IssuerPassesResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useEffect, useState } from 'hono/jsx/dom'

import type { PassQuery } from './management-api.ts'

export type PassesLoad = (query: PassQuery) => Promise<Result<IssuerPassesResponse>>
export type IssuerPassesState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; data: IssuerPassesResponse }

interface PassesController {
  state: IssuerPassesState
  refresh: () => void
}

export const useIssuerPasses = (load: PassesLoad, query: PassQuery): PassesController => {
  const key = JSON.stringify([query.page, query.pageSize, query.q, query.cardId, query.status])
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; state: IssuerPassesState }>({
    key,
    state: { kind: 'loading' },
  })
  useEffect(() => {
    let current = true
    setResult({ key, state: { kind: 'loading' } })
    const run = async (): Promise<void> => {
      try {
        const response = await load(query)
        if (current) {
          setResult({ key, state: response.ok ? { data: response.body, kind: 'ready' } : { kind: 'failed' } })
        }
      } catch {
        if (current) {
          setResult({ key, state: { kind: 'failed' } })
        }
      }
    }
    void run()
    return () => {
      current = false
    }
  }, [key, load, attempt])
  return {
    refresh: () => {
      setResult({ key, state: { kind: 'loading' } })
      setAttempt((value) => value + 1)
    },
    state: result.key === key ? result.state : { kind: 'loading' },
  }
}
