import type { IssueResponse, MembersResponse, RevokeResponse } from '@fuda/sdk'

import { API_BASE_URL } from './config.ts'

export type Result<T> = { ok: true; body: T } | { ok: false; error: string; status: number }

// The admin token lives only in memory for the tab's lifetime (spec §10). It is
// fuda's API authorization, not a user account: an api with ADMIN_TOKEN unset
// serves every admin route in open mode and ignores this header.
const adminFetch = async <T>(token: string, path: string, init: RequestInit = {}): Promise<Result<T>> => {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an untyped JSON error body
      const isObject = typeof json === 'object' && json !== null
      const error = isObject && 'error' in json ? String(json.error) : `api ${res.status}`
      return { error, ok: false, status: res.status }
    }
    // SAFETY: each admin endpoint's 2xx body is the typed response the caller names (spec §3).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the response body is untyped JSON
    return { body: json as T, ok: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'network error', ok: false, status: 0 }
  }
}

export const listMembers = async (token: string): Promise<Result<MembersResponse>> =>
  await adminFetch<MembersResponse>(token, '/members')

export const issueRight = async (
  token: string,
  body: Record<string, string | number>,
): Promise<Result<IssueResponse>> =>
  await adminFetch<IssueResponse>(token, '/issue', { body: JSON.stringify(body), method: 'POST' })

export const revokeRight = async (token: string, uid: string): Promise<Result<RevokeResponse>> =>
  await adminFetch<RevokeResponse>(token, '/revoke', {
    body: JSON.stringify({ uid }),
    method: 'POST',
  })
