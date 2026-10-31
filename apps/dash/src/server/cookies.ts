import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { ADMIN_COOKIE, OPERATOR_COOKIE } from '../cookie-names.ts'
import type { LOCALE_COOKIE, THEME_COOKIE } from '../cookie-names.ts'

// The dashboard's session lives in HttpOnly cookies on its own host, never in
// browser storage (docs/adr/0010-void-pages-and-frontend-workers.md). The
// Worker forwards the value to the api as `Authorization: Bearer`.

// The api's session lifetime (apps/api/src/auth/session.ts).
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const secure = (c: Context): boolean => new URL(c.req.url).protocol === 'https:'

export type Credential = { kind: 'operator'; token: string } | { kind: 'admin'; token: string }

export const readCredential = (c: Context): Credential | null => {
  const operator = getCookie(c, OPERATOR_COOKIE)
  if (operator !== undefined && operator !== '') {
    return { kind: 'operator', token: operator }
  }
  const admin = getCookie(c, ADMIN_COOKIE)
  return admin === undefined ? null : { kind: 'admin', token: admin }
}

// Each kind of sign-in replaces the other, so one browser holds one surface.
export const startOperatorSession = (c: Context, token: string): void => {
  deleteCookie(c, ADMIN_COOKIE, { path: '/' })
  setCookie(c, OPERATOR_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'Lax',
    secure: secure(c),
  })
}

// No Max-Age: the admin token is a deployment credential and ends with the
// browser session.
export const startAdminSession = (c: Context, token: string): void => {
  deleteCookie(c, OPERATOR_COOKIE, { path: '/' })
  setCookie(c, ADMIN_COOKIE, token, { httpOnly: true, path: '/', sameSite: 'Lax', secure: secure(c) })
}

export const endSession = (c: Context): void => {
  deleteCookie(c, OPERATOR_COOKIE, { path: '/' })
  deleteCookie(c, ADMIN_COOKIE, { path: '/' })
}

export const readPreference = (c: Context, name: typeof THEME_COOKIE | typeof LOCALE_COOKIE): string | null =>
  getCookie(c, name) ?? null

// The two session cookies, expired, for a response the Worker builds itself
// rather than through Hono's context.
export const expiredSessionCookies = (): string[] =>
  [OPERATOR_COOKIE, ADMIN_COOKIE].map((name) => `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)
