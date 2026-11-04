import { resolveLocale } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { apiHeaders, clearCookie, readCookie } from '@fuda/libs/worker'
import type { MemberSessionResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import { resolveThemeMode } from '@fuda/ui/theme'
import type { ThemeMode } from '@fuda/ui/theme'
import type { Context } from 'hono'

import { LOCALE_COOKIE, MEMBER_COOKIE, THEME_COOKIE } from '../cookie-names.ts'
import { isRedirectRoute, routeFor, safeMemberReturn, signInHref } from '../route.ts'

// What every page knows about the request. Pages read it with `useShared()`.
export interface AppShared {
  // The api's public origin, for the one link the browser must open there:
  // the browser pass page (src/pass-links.ts).
  apiOrigin: string
  locale: Locale
  // The member session could not be checked (the api was unreachable or
  // failing): neither confirmed nor ended, so a member page offers a retry.
  restoreFailed: boolean
  signedIn: boolean
  theme: ThemeMode
}

export interface SessionOutcome {
  redirect: string | null
  shared: AppShared
  token: string | null
}

const isPageRequest = (c: Context, pathname: string): boolean =>
  c.req.method === 'GET' &&
  !pathname.startsWith('/api/') &&
  !pathname.startsWith('/session/') &&
  !pathname.startsWith('/@fs/') &&
  !pathname.startsWith('/@id/') &&
  !pathname.startsWith('/@vite/') &&
  !/\.[a-z0-9]+$/iu.test(pathname)

// One pass over the request: preferences from cookies, the member session
// checked only where a page needs it, and the redirects the URL calls for.
export const resolveSession = async (
  c: Context,
  url: URL,
  apiBaseUrl: string,
  appOrigin: string,
): Promise<SessionOutcome> => {
  const shared: AppShared = {
    apiOrigin: apiBaseUrl.replace(/\/$/u, ''),
    locale: resolveLocale(readCookie(c, LOCALE_COOKIE), c.req.header('accept-language') ?? null),
    restoreFailed: false,
    signedIn: false,
    theme: resolveThemeMode(readCookie(c, THEME_COOKIE)),
  }
  const token = readCookie(c, MEMBER_COOKIE)
  if (!isPageRequest(c, url.pathname)) {
    return { redirect: null, shared, token }
  }
  const target = `${url.pathname}${url.search}`
  const route = routeFor(url.origin, target, appOrigin)
  // Member and card pages answer only on the app origin.
  if (isRedirectRoute(route)) {
    return { redirect: route.redirect, shared, token }
  }
  // Any other unknown path is the member top.
  if (route === 'top' && url.pathname !== '/') {
    return { redirect: '/', shared, token }
  }
  shared.signedIn = token !== null && token !== ''
  const member = route === 'rights' || route === 'settings' || route === 'signed' || route === 'private'
  if (route === 'signin' && shared.signedIn) {
    return { redirect: safeMemberReturn(url.searchParams.get('return')), shared, token }
  }
  if (!member) {
    return { redirect: null, shared, token }
  }
  if (!shared.signedIn || token === null) {
    return { redirect: signInHref(target), shared, token }
  }
  const me = await apiFetch<MemberSessionResponse>(apiBaseUrl, '/auth/member/me', {
    headers: apiHeaders(c, token),
  })
  if (me.ok) {
    return { redirect: null, shared, token }
  }
  if (me.status === 401) {
    clearCookie(c, MEMBER_COOKIE)
    shared.signedIn = false
    return { redirect: signInHref(target), shared, token: null }
  }
  shared.restoreFailed = true
  return { redirect: null, shared, token }
}
