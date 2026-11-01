import type { Hex, IssuerView } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'

import { fetchJson } from './session-request.ts'

// The browser's side of the Worker's session routes (src/server/session-routes.ts).
export const verifyOperator = async (body: {
  address: Hex
  nonce: Hex
  signature: Hex
}): Promise<Result<{ issuer: IssuerView | null }>> =>
  await fetchJson('/session/operator', { body: JSON.stringify(body), method: 'POST' })

export const startAdminSession = async (token: string): Promise<Result<{ ok: true }>> =>
  await fetchJson('/session/admin', { body: JSON.stringify({ token }), method: 'POST' })

export const endSession = async (): Promise<Result<{ ok: true }>> =>
  await fetchJson('/session/sign-out', { body: '{}', method: 'POST' })
