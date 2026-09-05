import { Hono } from 'hono'
import type { Context } from 'hono'

import { getDb } from './db/client.ts'
import type { AppEnv, Variables } from './env.ts'
import { errorResponse } from './json.ts'
import { authModeHeader } from './middleware/admin-auth.ts'
import { corsPolicy } from './middleware/cors.ts'
import { health } from './routes/health.ts'
import { issueRoutes } from './routes/issue.ts'
import { membersRoutes } from './routes/members.ts'
import { passRoutes } from './routes/pass.ts'
import { revokeRoutes } from './routes/revoke.ts'
import { verifyRoutes } from './routes/verify.ts'
import { noAdmitHook } from './verify/admit.ts'
import type { AdmitHook } from './verify/admit.ts'

export interface AppDeps {
  chain: Variables['chain']
  now?: () => number
  onAdmit?: AdmitHook
}

// Any error not already turned into a decision-shaped response by a route
// handler. 'internal' is not in @fuda/sdk's ErrorCode list — it names an
// unclassified defect, so the error itself is logged rather than swallowed.
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
  app.route('/', health)
  app.route('/', verifyRoutes)
  app.route('/', issueRoutes)
  app.route('/', revokeRoutes)
  app.route('/', membersRoutes)
  app.route('/', passRoutes)
  app.onError(unclassifiedError)
  return app
}
