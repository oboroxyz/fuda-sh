import { Hono } from 'hono'

import { getDb } from './db/client.ts'
import type { AppEnv, Variables } from './env.ts'
import { authModeHeader } from './middleware/admin-auth.ts'
import { corsPolicy } from './middleware/cors.ts'
import { health } from './routes/health.ts'

export interface AppDeps {
  chain: Variables['chain']
  now?: () => number
}

export const createApp = (deps: AppDeps): Hono<AppEnv> => {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('chain', deps.chain)
    c.set('db', getDb(c.env))
    c.set('now', deps.now ?? (() => Math.floor(Date.now() / 1000)))
    await next()
  })
  app.use('*', corsPolicy())
  app.use('*', authModeHeader())
  app.route('/', health)
  return app
}
