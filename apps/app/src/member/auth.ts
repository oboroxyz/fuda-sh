import { passkeyClient } from '@fuda/libs/auth'
import type { PasskeyOutcome as Outcome } from '@fuda/libs/auth'
import { apiFetch, fetchJson } from '@fuda/sdk/http'

import { API_BASE_URL } from '../config.ts'

export type { PasskeyFailure } from '@fuda/libs/auth'
export type PasskeyOutcome = Outcome<{ ok: true }>

export const memberPasskeys = passkeyClient<{ ok: true }>('member', {
  api: async (path, init) => await apiFetch(API_BASE_URL, path, init),
  session: fetchJson,
})
