import { apiOriginFor } from '@fuda/libs/worker'
import { themeScript } from '@fuda/ui/theme'
import { defineMiddleware } from 'void'

import { resolveSession } from '../src/server/session.ts'
import type { DashShared } from '../src/server/session.ts'

declare module 'void' {
  interface CloudContextVariables {
    shared: DashShared
    // The session's api credential: an operator session token or the admin token.
    token: string | null
  }
}

declare global {
  interface VoidGeneratedEnvBindings {
    API_BASE_URL?: string
  }
}

export default defineMiddleware(async (c, next) => {
  const outcome = await resolveSession(c, apiOriginFor(c.env.API_BASE_URL))
  if (outcome.redirect !== null) {
    return c.redirect(outcome.redirect)
  }
  c.set('token', outcome.token)
  c.set('shared', outcome.shared)
  c.set('headDefaults', {
    htmlAttrs: { lang: outcome.shared.locale },
    script: [{ innerHTML: themeScript(outcome.shared.theme) }],
  })
  await next()
  // The approval button acts in one click for a signed-in Operator, so no other
  // site may put these pages in a frame and steer that click.
  c.header('Content-Security-Policy', "frame-ancestors 'none'")
  c.header('X-Frame-Options', 'DENY')
})
