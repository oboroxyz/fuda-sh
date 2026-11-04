import { PAGE_COPY, pick } from '@fuda/i18n'
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
  const page = pick(PAGE_COPY, outcome.shared.locale)
  c.set('headDefaults', {
    htmlAttrs: { lang: outcome.shared.locale },
    meta: [
      { content: page.description, name: 'description' },
      { content: page.dashTitle, property: 'og:title' },
      { content: page.description, property: 'og:description' },
      { content: page.ogLocale, property: 'og:locale' },
    ],
    script: [{ innerHTML: themeScript(outcome.shared.theme) }],
    title: page.dashTitle,
  })
  await next()
  // The approval button acts in one click for a signed-in Operator, so no other
  // site may put these pages in a frame and steer that click.
  c.header('Content-Security-Policy', "frame-ancestors 'none'")
  c.header('X-Frame-Options', 'DENY')
})
