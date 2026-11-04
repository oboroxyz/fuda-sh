import type { Context } from 'hono'

import { resolveSession } from '../auth/session.ts'
import type { SessionAudience, SessionResolution } from '../auth/session.ts'
import type { AppEnv } from '../env.ts'

// The session behind the request's bearer token. A missing token reads the same
// as an unknown one, so each caller decides only what those mean on its route.
export const bearerSession = async (
  c: Context<AppEnv>,
  audience: SessionAudience,
): Promise<SessionResolution> => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  return token === ''
    ? { kind: 'invalid' }
    : await resolveSession(c.get('db'), token, c.get('now')(), audience)
}
