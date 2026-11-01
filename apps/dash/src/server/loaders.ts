import { apiHeaders } from '@fuda/libs/worker'
import type { MembersResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'
import type { Context } from 'hono'

import type { MembersState } from '../members-state.ts'
import { memberRowView } from '../members-view.ts'
import { endSession } from './cookies.ts'
import { SIGN_IN_PATH } from './guard.ts'
import { UNAUTHORIZED_QUERY } from './session.ts'

// A loader's api read hit a 401: the session is over, and the browser goes to
// sign-in to say so.
const sessionExpired = (c: Context): Response => {
  endSession(c)
  return c.redirect(`${SIGN_IN_PATH}?${UNAUTHORIZED_QUERY}`)
}

export interface MembersProps {
  // Where member pass links point: the api's own origin, which Apple and Google
  // Wallet fetch directly.
  apiBaseUrl: string
  members: MembersState
}

export const loadMembers = async (
  c: Context,
  apiBaseUrl: string,
  token: string | null,
): Promise<MembersProps | Response> => {
  const result: Result<MembersResponse> = await apiFetch(apiBaseUrl, '/members', {
    headers: apiHeaders(c, token),
  })
  if (!result.ok && result.status === 401) {
    return sessionExpired(c)
  }
  return {
    apiBaseUrl,
    members: result.ok
      ? { kind: 'ready', rows: result.body.members.map((row) => memberRowView(row, apiBaseUrl)) }
      : { kind: 'error', message: result.error, previousRows: null },
  }
}
