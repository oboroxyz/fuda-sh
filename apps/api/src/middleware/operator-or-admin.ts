import type { MiddlewareHandler } from 'hono'

import { resolveSession } from '../auth/session.ts'
import type { AppEnv } from '../env.ts'
import { adminAuth } from './admin-auth.ts'

// `/members` and `/revoke` were built for fuda's own operators, holding the
// deployment's admin token. A venue owner signs in with their wallet instead,
// and until now that session bought them nothing on either route: they had to
// paste fuda's admin token to see their own members, which also showed them
// everyone else's.
//
// Both credentials arrive in the same header, so this resolves a session first
// and falls through to the admin check when there is none. A route that sees an
// operator scopes itself to that venue; a route that sees the admin token keeps
// its whole-deployment view.
export const operatorOrAdmin = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const resolved =
    token === ''
      ? { kind: 'invalid' as const }
      : await resolveSession(c.get('db'), token, c.get('now')(), 'operator')
  if (resolved.kind === 'wrong-audience') {
    return c.json({ error: 'unauthorized' }, 401)
  }
  if (resolved.kind === 'invalid') {
    // `actingIssuer` is always set, so a route never has to ask whether the
    // middleware ran: null is "the admin token", which no venue owns.
    c.set('actingIssuer', null)
    return await adminAuth()(c, next)
  }
  c.set('operator', resolved.session)
  c.set('actingIssuer', resolved.session.issuerId)
  await next()
}
