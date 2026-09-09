import type { MiddlewareHandler } from 'hono'

import { resolveSession } from '../auth/session.ts'
import type { AppEnv } from '../env.ts'

export const memberAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const resolved =
    token === ''
      ? { kind: 'invalid' as const }
      : await resolveSession(c.get('db'), token, c.get('now')(), 'member')
  if (resolved.kind !== 'valid') {
    return c.json({ error: 'unauthorized' }, 401)
  }
  c.set('member', resolved.session)
  await next()
}
