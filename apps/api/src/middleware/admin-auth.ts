import type { MiddlewareHandler } from 'hono'

import type { AppEnv } from '../env.ts'

const sha256 = (s: string): Promise<ArrayBuffer> =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))

// Constant-time compare: hash both sides to equal length, then timingSafeEqual.
export const tokenMatches = async (presented: string, expected: string): Promise<boolean> => {
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)])
  return crypto.subtle.timingSafeEqual(a, b)
}

const isTokenUnset = (token: string | undefined): boolean => token === undefined || token === ''

export const adminAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const expected = c.env.ADMIN_TOKEN
  if (isTokenUnset(expected)) {
    await next()
    c.res.headers.set('x-auth-mode', 'open')
    return
  }
  const header = c.req.header('Authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (presented === '' || !(await tokenMatches(presented, expected))) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}

// Global: every response carries x-auth-mode: open while ADMIN_TOKEN is unset (local dev).
export const authModeHeader = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await next()
  if (isTokenUnset(c.env.ADMIN_TOKEN)) {
    c.res.headers.set('x-auth-mode', 'open')
  }
}
