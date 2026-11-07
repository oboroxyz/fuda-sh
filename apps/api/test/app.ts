import { Hono } from 'hono'
import type { TypedHandler } from 'void'

import type { AppEnv } from '../src/env.ts'
import { apiAuthMode, apiCors, apiErrors, apiNoStore } from '../src/middleware.ts'
import { requestContext } from '../src/request.ts'
import type { AppDeps } from '../src/request.ts'

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const routes = import.meta.glob<Partial<Record<(typeof methods)[number], TypedHandler>>>(
  '../routes/**/*.ts',
  // exhaustive: routes/.well-known is a dot directory.
  { eager: true, exhaustive: true },
)

// Only a workerd test adapter: production discovery and registration belong to Void.
export const createApp = (deps: AppDeps): Hono<AppEnv> => {
  const app = new Hono<AppEnv>()
  app.use('*', apiErrors)
  app.use('*', requestContext(deps))
  app.use('*', apiCors)
  app.use('*', apiAuthMode)
  app.use('*', apiNoStore)
  for (const [file, handlers] of Object.entries(routes).toSorted(
    ([a], [b]) => a.split('[').length - b.split('[').length || a.localeCompare(b),
  )) {
    const path =
      file
        .slice('../routes'.length)
        .replace(/\.ts$/u, '')
        .replace(/\/index$/u, '')
        .replaceAll(/\[(?<param>[^\]]+)\]/gu, ':$<param>') || '/'
    for (const method of methods) {
      const handler = handlers[method]
      if (handler !== undefined) {
        app.on(method, path, async (c) => {
          const response = await handler(c)
          if (!(response instanceof Response)) {
            throw new TypeError('API handlers must return a Response')
          }
          return response
        })
      }
    }
  }
  return app
}
