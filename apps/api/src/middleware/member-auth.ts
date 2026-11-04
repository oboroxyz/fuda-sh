import type { MiddlewareHandler } from 'hono'

import type { AppEnv } from '../env.ts'
import { memberBearerSession } from './bearer-session.ts'

export const memberAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const resolved = await memberBearerSession(c)
  if (resolved.kind !== 'valid') {
    return c.json({ error: 'unauthorized' }, 401)
  }
  c.set('member', resolved.session)
  await next()
}
