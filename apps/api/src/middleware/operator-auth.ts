import type { MiddlewareHandler } from 'hono'

import type { AppEnv } from '../env.ts'
import { bearerSession } from './bearer-session.ts'

// A session token from POST /auth/verify. The admin token is deliberately not
// accepted here: an issuer belongs to the passkey address that created it, and
// the admin bearer has no address to own one.
export const operatorAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const resolved = await bearerSession(c, 'operator')
  if (resolved.kind !== 'valid') {
    return c.json({ error: 'unauthorized' }, 401)
  }
  c.set('operator', resolved.session)
  await next()
}
