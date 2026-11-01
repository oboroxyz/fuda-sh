import { apiOriginFor } from '@fuda/libs/worker'
import { themeScript } from '@fuda/ui/theme'
import { defineMiddleware } from 'void'

import { APP_ORIGIN } from '../src/config.ts'
import { resolveSession } from '../src/server/session.ts'
import type { AppShared } from '../src/server/session.ts'

declare module 'void' {
  interface CloudContextVariables {
    // The URL the browser asked for, before a `/@<handle>` rewrite.
    requestUrl: URL
    shared: AppShared
    // The member session token, for the Worker's api calls.
    token: string | null
  }
}

declare global {
  interface VoidGeneratedEnvBindings {
    API_BASE_URL?: string
  }
}

// Vite's own module URLs in development, which also start with `/@`.
const DEV_MODULE_PATH = /^\/@(?:fs|id|vite)\//u

export default defineMiddleware(async (c, next) => {
  // File routes cannot name a `@<handle>` segment, so the venue pages live
  // under pages/venue/ and keep their public `/@<handle>` URLs through this
  // rewrite; the browser's address does not change. Middleware runs again at
  // the destination.
  const { pathname } = new URL(c.req.url)
  if (!c.isRewritten() && pathname.startsWith('/@') && !DEV_MODULE_PATH.test(pathname)) {
    return await c.rewrite(`/venue/${pathname.slice(2)}`)
  }
  // A `/@<handle>` page arrives rewritten to /venue/; the routing decisions
  // are about the URL the browser asked for.
  const url = c.originalUrl() ?? new URL(c.req.url)
  const outcome = await resolveSession(c, url, apiOriginFor(c.env.API_BASE_URL), APP_ORIGIN)
  if (outcome.redirect !== null) {
    return c.redirect(outcome.redirect)
  }
  c.set('requestUrl', url)
  c.set('token', outcome.token)
  c.set('shared', outcome.shared)
  c.set('headDefaults', {
    htmlAttrs: { lang: outcome.shared.locale },
    script: [{ innerHTML: themeScript(outcome.shared.theme) }],
  })
  await next()
})
