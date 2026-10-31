import type { Hex } from '@fuda/sdk'
import { fetchJson } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

// The browser's side of the Worker's session routes (src/server/session-routes.ts).
export const verifyMember = async (body: {
  address: Hex
  nonce: Hex
  signature: Hex
}): Promise<Result<{ address: Hex }>> =>
  await fetchJson('/session/member', { body: JSON.stringify(body), method: 'POST' })

export const endSession = async (): Promise<Result<{ ok: true }>> =>
  await fetchJson('/session/sign-out', { body: '{}', method: 'POST' })
