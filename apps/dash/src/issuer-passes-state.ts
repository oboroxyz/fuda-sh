import type { IssuerPassesResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

import type { PassQuery } from './management-api.ts'

export type PassesLoad = (query: PassQuery) => Promise<Result<IssuerPassesResponse>>
export type IssuerPassesState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; data: IssuerPassesResponse }

interface PassesController {
  state: Accessor<IssuerPassesState>
  refresh: () => void
}

// Loads one page of the venue's passes and reloads whenever the query changes.
// A response for a query that is no longer current is dropped.
export const createIssuerPasses = (load: PassesLoad, query: Accessor<PassQuery>): PassesController => {
  const key = createMemo(() => {
    const current = query()
    return JSON.stringify([current.page, current.pageSize, current.q, current.cardId, current.status])
  })
  const [attempt, setAttempt] = createSignal(0)
  const [state, setState] = createSignal<IssuerPassesState>({ kind: 'loading' })
  createEffect(
    on([key, attempt], () => {
      let current = true
      setState({ kind: 'loading' })
      const run = async (): Promise<void> => {
        try {
          const response = await load(query())
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
      onCleanup(() => {
        current = false
      })
    }),
  )
  return {
    refresh: () => {
      setAttempt((value) => value + 1)
    },
    state,
  }
}
