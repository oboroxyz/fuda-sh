import { API_VERSION_PREFIX } from '@fuda/sdk/http'
import { Hono } from 'hono'
import type { Context } from 'hono'

import { getDb } from './db/client.ts'
import type { AppEnv, Variables } from './env.ts'
import { errorResponse } from './json.ts'
import { authModeHeader } from './middleware/admin-auth.ts'
import { corsPolicy } from './middleware/cors.ts'
import { authRoutes } from './routes/auth.ts'
import { challengeRoutes } from './routes/challenge.ts'
import { ensClaimRoutes } from './routes/ens-claim.ts'
import { ensGatewayRoutes } from './routes/ens-gateway.ts'
import { health } from './routes/health.ts'
import { issueRoutes } from './routes/issue.ts'
import { issuerManagementRoutes } from './routes/issuer-management.ts'
import { issuersRoutes } from './routes/issuers.ts'
import { assetRoutes, mediaRoutes } from './routes/media.ts'
import { membersRoutes } from './routes/members.ts'
import { passRoutes } from './routes/pass.ts'
import { receptionRoutes } from './routes/reception.ts'
import { revokeRoutes } from './routes/revoke.ts'
import { verifySignedRoutes } from './routes/verify-signed.ts'
import { verifyRoutes } from './routes/verify.ts'
import { noAdmitHook } from './verify/admit.ts'
import type { AdmitHook } from './verify/admit.ts'

export interface AppDeps {
  chain: Variables['chain']
  now?: () => number
  onAdmit?: AdmitHook
}

// Any error not already turned into a decision-shaped response by a route
// handler. `internal` is the sdk's catch-all ErrorCode for an unclassified
// defect (500); the error itself is logged rather than swallowed.
const unclassifiedError = (err: Error, c: Context<AppEnv>): Response => {
  // oxlint-disable-next-line no-console -- unclassified defect: the only signal wrangler tail gets
  console.error(err)
  return errorResponse(c, 'internal', 500)
}

export const createApp = (deps: AppDeps): Hono<AppEnv> => {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('chain', deps.chain)
    c.set('db', getDb(c.env))
    c.set('now', deps.now ?? (() => Math.floor(Date.now() / 1000)))
    c.set('onAdmit', deps.onAdmit ?? noAdmitHook)
    await next()
  })
  app.use('*', corsPolicy())
  app.use('*', authModeHeader())
  // Everything a program calls fuda for lives under a version prefix, so a
  // breaking change can ship as /v2 while /v1 keeps answering.
  const v1 = new Hono<AppEnv>()
  v1.route('/', authRoutes)
  v1.route('/', issuersRoutes)
  v1.route('/', issuerManagementRoutes)
  v1.route('/', receptionRoutes)
  v1.route('/', mediaRoutes)
  v1.route('/', challengeRoutes)
  v1.route('/', ensClaimRoutes)
  v1.route('/', verifyRoutes)
  v1.route('/', verifySignedRoutes)
  v1.route('/', issueRoutes)
  v1.route('/', revokeRoutes)
  v1.route('/', membersRoutes)
  app.route(API_VERSION_PREFIX, v1)

  // Outside the prefix on purpose. Each of these URLs is held by someone fuda
  // cannot reach to update — a pass saved in Apple or Google Wallet, a mark
  // printed on a page, the gateway address written into the deployed ENS
  // resolver, a health check in someone's monitoring. Versioning a URL that can
  // never be reissued would only guarantee that /v1 must live forever.
  app.route('/', health)
  app.route('/', passRoutes)
  app.route('/', assetRoutes)
  app.route('/', ensGatewayRoutes)
  app.onError(unclassifiedError)
  return app
}
