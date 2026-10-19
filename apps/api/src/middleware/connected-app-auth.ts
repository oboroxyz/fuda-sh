import type { ConnectedAppScope } from '@fuda/sdk'
import type { Context, MiddlewareHandler } from 'hono'

import { appHasOrigin, resolveAccessToken } from '../connected-apps/store.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse } from '../json.ts'

// RFC 6750 §3: a resource server says why in WWW-Authenticate as well as the body.
const refuse = (c: Context<AppEnv>, header: string, status: 401 | 403): Response => {
  c.header('WWW-Authenticate', header)
  return errorResponse(c, status === 401 ? 'unauthorized' : 'insufficient_scope', status)
}

// A connected app's access token (docs/specs/connected-apps.md#resource-routes).
// The token names one issuer, and every route behind this reads only that one.
// A browser call must come from one of the token's own app origins, so a token
// copied into another site's page is refused there even where CORS would allow
// that site.
export const connectedAppAuth =
  (scope: ConnectedAppScope | null): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    c.header('cache-control', 'no-store')
    const header = c.req.header('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    const grant = token === '' ? null : await resolveAccessToken(c.get('db'), token, c.get('now')())
    if (grant === null) {
      return refuse(c, 'Bearer error="invalid_token"', 401)
    }
    const origin = c.req.header('Origin')
    if (origin !== undefined && !(await appHasOrigin(c.get('db'), grant.clientId, origin))) {
      return refuse(c, 'Bearer error="invalid_token"', 401)
    }
    if (scope !== null && !grant.scope.includes(scope)) {
      return refuse(c, `Bearer error="insufficient_scope", scope="${scope}"`, 403)
    }
    c.set('connected', grant)
    await next()
  }
