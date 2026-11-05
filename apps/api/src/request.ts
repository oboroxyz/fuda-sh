import type { Context, MiddlewareHandler } from 'hono'

import { attendanceHook } from './attendance/attendance-hook.ts'
import { getDb } from './db/client.ts'
import type { AppEnv, Variables } from './env.ts'
import { errorResponse } from './json.ts'
import { applePushSenderFrom } from './pass/apple-push.ts'
import { buildChain, schemaSetsOf } from './runtime.ts'
import { noAdmitHook } from './verify/admit.ts'
import type { AdmitHook } from './verify/admit.ts'

export interface AppDeps {
  applePush?: Variables['applePush']
  chain: Variables['chain']
  now?: () => number
  onAdmit?: AdmitHook
}

export const requestContext =
  (deps?: AppDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const db = getDb(c.env)
    const chain = deps?.chain ?? buildChain(c.env)
    c.set('applePush', deps?.applePush ?? applePushSenderFrom(c.env.APPLE_PUSH_CERT))
    c.set('chain', chain)
    c.set('db', db)
    c.set('now', deps?.now ?? (() => Math.floor(Date.now() / 1000)))
    c.set(
      'onAdmit',
      deps === undefined
        ? attendanceHook({ chain, db, sets: schemaSetsOf(c.env) })
        : (deps.onAdmit ?? noAdmitHook),
    )
    await next()
  }

export const unclassifiedError = (err: Error, c: Context<AppEnv>): Response => {
  // oxlint-disable-next-line no-console -- unclassified failures must remain observable
  console.error(err)
  return errorResponse(c, 'internal', 500)
}

export const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.header('cache-control', 'no-store')
  await next()
}
