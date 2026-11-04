import type { MiddlewareHandler } from 'hono'

import type { AppEnv } from '../env.ts'
import { operatorBearerSession } from './bearer-session.ts'

// A session token from a passkey or wallet sign-in. The admin token is deliberately
// not accepted here: an issuer belongs to the account or address that created it, and
// the admin bearer is neither.
export const operatorAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const resolved = await operatorBearerSession(c)
  if (resolved.kind !== 'valid') {
    return c.json({ error: 'unauthorized' }, 401)
  }
  c.set('operator', resolved.session)
  await next()
}
