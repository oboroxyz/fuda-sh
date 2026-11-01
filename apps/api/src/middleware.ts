import { defineMiddleware } from 'void'

import type { Variables } from './env.ts'
import { gatewayError } from './handlers/ens-gateway.ts'
import { authModeHeader } from './middleware/admin-auth.ts'
import { corsPolicy } from './middleware/cors.ts'
import { noStore, requestContext, unclassifiedError } from './request.ts'
import type { DevBindings } from './runtime.ts'

// Target configuration and secrets supply these bindings; Void does not infer them.
declare global {
  // oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Void's binding augmentation point
  interface VoidGeneratedEnvBindings extends DevBindings {}
}

declare module 'void' {
  // oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Void's request-context augmentation point
  interface CloudContextVariables extends Variables {}
}

export const apiContext = defineMiddleware(requestContext())
export const apiCors = defineMiddleware(corsPolicy())
export const apiAuthMode = defineMiddleware(authModeHeader())
export const apiNoStore = defineMiddleware(async (c, next) => {
  const { path } = c.req
  if (
    path.startsWith('/v1/auth/') ||
    path === '/v1/connected-apps' ||
    path.startsWith('/v1/connected-apps/') ||
    path.startsWith('/v1/oauth/')
  ) {
    return await noStore(c, next)
  }
  await next()
})

// Hono records downstream exceptions on c.error before unwinding middleware.
// Restore the API's wire error formats, including the unversioned ENS gateway.
export const apiErrors = defineMiddleware(async (c, next) => {
  await next()
  if (c.error !== undefined) {
    c.res = c.req.path === '/ens/gateway' ? gatewayError(c.error, c) : unclassifiedError(c.error, c)
  }
})
