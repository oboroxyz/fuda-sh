import { resolveLocale } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { apiHeaders } from '@fuda/libs/worker'
import type { IssuerMeResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import { resolveThemeMode } from '@fuda/ui/theme'
import type { ThemeMode } from '@fuda/ui/theme'
import type { Context } from 'hono'

import { LOCALE_COOKIE, THEME_COOKIE } from '../cookie-names.ts'
import type { DashSurface } from '../router.ts'
import { endSession, readCredential, readPreference } from './cookies.ts'
import { guardRedirect, SIGN_IN_PATH } from './guard.ts'

// What every page knows about the request, from the cookies and one
// /issuers/me read. Pages read it with `useShared()`.
export interface DashShared {
  locale: Locale
  // The operator's venue and cards; null for an admin or signed-out session.
  operator: IssuerMeResponse | null
  // The session could not be checked (the api was unreachable or failing), so
  // it is neither confirmed nor ended. The layout offers a retry.
  restoreFailed: boolean
  surface: DashSurface | null
  theme: ThemeMode
}

export const UNAUTHORIZED_QUERY = 'reason=unauthorized'

// Requests the guard leaves alone: the forwarding route and the session routes
// carry their own rules, and anything with a file extension is an asset.
const isPageRequest = (c: Context, pathname: string): boolean =>
  c.req.method === 'GET' &&
  !pathname.startsWith('/api/') &&
  !pathname.startsWith('/session/') &&
  !pathname.startsWith('/@') &&
  !/\.[a-z0-9]+$/iu.test(pathname)

// The inline script that applies the theme before the first paint; `system`
// needs the browser's media query, so the server cannot decide it alone.
export const themeScript = (mode: ThemeMode): string =>
  `(function(m){var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.themeMode=m;r.dataset.theme=d?"dark":"light";r.classList.toggle("dark",d)})(${JSON.stringify(mode)})`

export interface SessionOutcome {
  redirect: string | null
  shared: DashShared
  token: string | null
}

export const resolveSession = async (c: Context, apiBaseUrl: string): Promise<SessionOutcome> => {
  const locale = resolveLocale(readPreference(c, LOCALE_COOKIE))
  const theme = resolveThemeMode(readPreference(c, THEME_COOKIE))
  const { pathname } = new URL(c.req.url)
  const credential = readCredential(c)
  const shared: DashShared = { locale, operator: null, restoreFailed: false, surface: null, theme }
  if (!isPageRequest(c, pathname)) {
    return { redirect: null, shared, token: credential?.token ?? null }
  }
  if (credential?.kind === 'admin') {
    shared.surface = 'admin'
  } else if (credential?.kind === 'operator') {
    const me = await apiFetch<IssuerMeResponse>(apiBaseUrl, '/issuers/me', {
      headers: apiHeaders(c, credential.token),
    })
    if (me.ok) {
      shared.surface = 'operator'
      shared.operator = me.body
    } else if (me.status === 401) {
      endSession(c)
      return { redirect: `${SIGN_IN_PATH}?${UNAUTHORIZED_QUERY}`, shared, token: null }
    } else {
      // Neither confirmed nor ended: every route shows the retry view.
      shared.surface = 'operator'
      shared.restoreFailed = true
      return { redirect: null, shared, token: credential.token }
    }
  }
  return {
    redirect: guardRedirect(pathname, shared.surface, shared.operator),
    shared,
    token: credential?.token ?? null,
  }
}
