import { fetchJson } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

// The browser's side of the Worker's session routes (src/server/session-routes.ts).
export const endSession = async (): Promise<Result<{ ok: true }>> =>
  await fetchJson('/session/sign-out', { body: '{}', method: 'POST' })
