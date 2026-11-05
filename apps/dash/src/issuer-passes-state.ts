import type { IssuerPassesResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useEffect, useRef, useState } from 'preact/hooks'

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

// Loads one page of the venue's passes and reloads whenever the query changes.
// A response for a query that is no longer current is dropped.
export const useIssuerPasses = (load: PassesLoad, query: PassQuery): PassesController => {
  const key = JSON.stringify([query.page, query.pageSize, query.q, query.cardId, query.status])
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<IssuerPassesState>({ kind: 'loading' })
  const latest = useRef({ load, query })
  latest.current = { load, query }
  useEffect(() => {
    let current = true
    setState({ kind: 'loading' })
    const run = async (): Promise<void> => {
      try {
        const response = await latest.current.load(latest.current.query)
        if (current) {
          setState(response.ok ? { data: response.body, kind: 'ready' } : { kind: 'failed' })
        }
      } catch {
        if (current) {
          setState({ kind: 'failed' })
        }
      }
    }
    void run()
    return () => {
      current = false
    }
  }, [key, attempt])
  return {
    refresh: () => {
      setAttempt((value) => value + 1)
    },
    state,
  }
}
