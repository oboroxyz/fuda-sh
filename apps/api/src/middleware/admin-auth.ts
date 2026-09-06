import type { MiddlewareHandler } from 'hono'

import type { AppEnv, Bindings } from '../env.ts'

// workerd implements crypto.subtle.timingSafeEqual (constant-time buffer compare),
// but @cloudflare/workers-types does not declare it yet. Narrow augmentation
// instead of a cast so the rest of SubtleCrypto stays fully typed.
declare global {
  interface SubtleCrypto {
    timingSafeEqual: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean
  }
}

const sha256 = async (s: string): Promise<ArrayBuffer> =>
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))

// Constant-time compare: hash both sides to equal length, then timingSafeEqual.
export const tokenMatches = async (presented: string, expected: string): Promise<boolean> => {
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)])
  return crypto.subtle.timingSafeEqual(a, b)
}

const isTokenUnset = (token: string | undefined): token is undefined | '' =>
  token === undefined || token === ''

const isSet = (v: string | undefined): v is string => v !== undefined && v !== ''

// A deployment with a real signer but no ADMIN_TOKEN would expose /issue,
// /revoke and /members to the internet. Fail closed: the admin routes answer
// 401 until the secret is set. Local dev on the fake chain has no signer, so
// it stays open (the fake-chain opt-in already requires SIGNER_PRIVATE_KEY unset).
export const adminLocked = (env: Pick<Bindings, 'ADMIN_TOKEN' | 'SIGNER_PRIVATE_KEY'>): boolean =>
  isTokenUnset(env.ADMIN_TOKEN) && isSet(env.SIGNER_PRIVATE_KEY)

let lockedWarned = false
const warnLockedOnce = (): void => {
  if (!lockedWarned) {
    lockedWarned = true
    // oxlint-disable-next-line no-console -- a misconfigured deploy must be visible in wrangler tail
    console.error(
      '[fuda-api] ADMIN_TOKEN is unset while SIGNER_PRIVATE_KEY is set: admin routes are locked. Run `wrangler secret put ADMIN_TOKEN`.',
    )
  }
}

export const adminAuth = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (adminLocked(c.env)) {
    warnLockedOnce()
    return c.json({ error: 'unauthorized' }, 401)
  }
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

// Global: every response carries x-auth-mode: open while ADMIN_TOKEN is unset and
// no signer is configured (local dev), or locked while the fail-closed guard is
// active, so an operator can read the state off any response (e.g. GET /health).
export const authModeHeader = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await next()
  if (adminLocked(c.env)) {
    c.res.headers.set('x-auth-mode', 'locked')
    return
  }
  if (isTokenUnset(c.env.ADMIN_TOKEN)) {
    c.res.headers.set('x-auth-mode', 'open')
  }
}
