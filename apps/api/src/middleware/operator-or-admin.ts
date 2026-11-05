import type { MiddlewareHandler } from 'hono'

import type { AppEnv } from '../env.ts'
import { errorResponse } from '../json.ts'
import { adminAuth } from './admin-auth.ts'
import { operatorBearerSession } from './bearer-session.ts'

// `/members` and `/revoke` were built for fuda's own operators, holding the
// deployment's admin token. A venue owner signs in instead,
// and until now that session bought them nothing on either route: they had to
// paste fuda's admin token to see their own members, which also showed them
// everyone else's.
//
// Both credentials arrive in the same header, so this resolves a session first
// and falls through to the admin check when there is none. A route that sees an
// operator scopes itself to that venue; a route that sees the admin token keeps
// its whole-deployment view. A session that owns no venue has nothing to act on.
export const operatorOrAdmin = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const resolved = await operatorBearerSession(c)
  if (resolved.kind === 'wrong-audience') {
    return c.json({ error: 'unauthorized' }, 401)
  }
  if (resolved.kind === 'invalid') {
    c.set('actingScope', { kind: 'admin' })
    return await adminAuth()(c, next)
  }
  c.set('operator', resolved.session)
  const { issuerId } = resolved.session
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  c.set('actingScope', { issuerId, kind: 'venue' })
  await next()
}
