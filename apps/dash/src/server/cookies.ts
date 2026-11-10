import { clearCookie, readCookie, SESSION_MAX_AGE_SECONDS, setSessionCookie } from '@fuda/libs/worker'
import type { Context } from 'hono'

import { ADMIN_COOKIE, OPERATOR_COOKIE } from '../cookie-names.ts'
import type { LOCALE_COOKIE, THEME_COOKIE } from '../cookie-names.ts'

// The dashboard's session lives in HttpOnly cookies on its own host, never in
// browser storage (../../../../docs/architecture.md#frontend-workers). The
// Worker forwards the value to the api as `Authorization: Bearer`.
export const SESSION_COOKIES = [OPERATOR_COOKIE, ADMIN_COOKIE] as const

export type Credential = { kind: 'operator'; token: string } | { kind: 'admin'; token: string }

export const readCredential = (c: Context): Credential | null => {
  const operator = readCookie(c, OPERATOR_COOKIE)
  if (operator !== null && operator !== '') {
    return { kind: 'operator', token: operator }
  }
  const admin = readCookie(c, ADMIN_COOKIE)
  return admin === null ? null : { kind: 'admin', token: admin }
}

// Each kind of sign-in replaces the other, so one browser holds one surface.
export const startOperatorSession = (c: Context, token: string): void => {
  clearCookie(c, ADMIN_COOKIE)
  setSessionCookie(c, OPERATOR_COOKIE, token, SESSION_MAX_AGE_SECONDS)
}

// No Max-Age: the admin token is a deployment credential and ends with the
// browser session.
export const startAdminSession = (c: Context, token: string): void => {
  clearCookie(c, OPERATOR_COOKIE)
  setSessionCookie(c, ADMIN_COOKIE, token)
}

export const endSession = (c: Context): void => {
  clearCookie(c, OPERATOR_COOKIE)
  clearCookie(c, ADMIN_COOKIE)
}

export const readPreference = (c: Context, name: typeof THEME_COOKIE | typeof LOCALE_COOKIE): string | null =>
  readCookie(c, name)
