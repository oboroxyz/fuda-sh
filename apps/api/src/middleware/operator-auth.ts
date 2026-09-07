import type { MiddlewareHandler } from 'hono'

import { resolveSession } from '../auth/session.ts'
import type { AppEnv } from '../env.ts'

// A session token from POST /auth/verify. The admin token is deliberately not
// accepted here: an issuer belongs to the passkey address that created it, and
// the admin bearer has no address to own one.
export const operatorAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const session = token === '' ? null : await resolveSession(c.get('db'), token, c.get('now')())
  if (session === null) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  c.set('operator', session)
  await next()
}
