import type { MiddlewareHandler } from 'hono'

import type { AppEnv } from '../env.ts'
import { bearerSession } from './bearer-session.ts'

export const memberAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const resolved = await bearerSession(c, 'member')
  // A session from before accounts names only an address, and signs in again.
  if (resolved.kind !== 'valid' || resolved.session.accountId === null) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  c.set('member', { ...resolved.session, accountId: resolved.session.accountId })
  await next()
}
