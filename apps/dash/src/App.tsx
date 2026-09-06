/** @jsxImportSource hono/jsx/dom */
import type { IssueResponse } from '@fuda/sdk'
import { useCallback, useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { issueRight, listMembers, revokeRight } from './api.ts'
import type { Result } from './api.ts'
import { ChainTruth } from './ChainTruth.tsx'
import { API_BASE_URL } from './config.ts'
import { IssueForm } from './IssueForm.tsx'
import { memberRowView } from './members-view.ts'
import type { MemberRowView } from './members-view.ts'
import { MembersTable } from './MembersTable.tsx'
import { TokenGate } from './TokenGate.tsx'

export const App = (): JSX.Element => {
  const [token, setToken] = useState<string | null>(null)
  const [rows, setRows] = useState<MemberRowView[]>([])
  const [error, setError] = useState<string | null>(null)

  // A 401 means the token this tab holds is wrong, whichever call saw it: drop
  // it and go back to the prompt. Returns true when it handled the failure.
  const dropOn401 = useCallback((status: number): boolean => {
    if (status !== 401) {
      return false
    }
    setToken(null)
    setRows([])
    setError('unauthorized — check the admin token')
    return true
  }, [])

  const reload = useCallback(
    async (t: string): Promise<void> => {
      const res = await listMembers(t)
      if (res.ok) {
        setRows(res.body.members.map((m) => memberRowView(m, API_BASE_URL)))
        setError(null)
        return
      }
      if (!dropOn401(res.status)) {
        setError(res.error)
      }
    },
    [dropOn401],
  )

  useEffect(() => {
    if (token !== null) {
      void reload(token)
    }
  }, [token, reload])

  if (token === null) {
    return (
      <>
        {error === null ? null : <div class="alert alert-error mx-auto mt-6 max-w-md">{error}</div>}
        <TokenGate onToken={setToken} />
      </>
    )
  }

  const onIssue = async (body: Record<string, string | number>): Promise<Result<IssueResponse>> => {
    const res = await issueRight(token, body)
    if (res.ok) {
      await reload(token)
      return res
    }
    // The form still shows the api's error code; a 401 also sends the operator back.
    dropOn401(res.status)
    return res
  }

  const onRevoke = async (uid: string): Promise<void> => {
    const res = await revokeRight(token, uid)
    if (!res.ok && dropOn401(res.status)) {
      return
    }
    setError(res.ok ? null : res.error)
    await reload(token)
  }

  return (
    <main class="flex flex-col gap-6 p-6">
      <header class="navbar bg-base-200 rounded-box">
        <span class="px-2 text-xl font-bold">fuda dash</span>
        <span class="px-2 text-xs opacity-60">{API_BASE_URL}</span>
      </header>
      {error === null ? null : <div class="alert alert-error">{error}</div>}
      <IssueForm onIssue={onIssue} />
      <section class="card bg-base-200 p-4">
        <h2 class="mb-2 text-lg font-bold">Members</h2>
        <MembersTable
          rows={rows}
          onRevoke={(uid) => {
            void onRevoke(uid)
          }}
        />
      </section>
      <ChainTruth />
    </main>
  )
}
