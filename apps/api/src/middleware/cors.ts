import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

import type { AppEnv } from '../env.ts'

const PROD_ORIGINS = new Set(['https://app.fuda.sh', 'https://dash.fuda.sh', 'https://gate.fuda.sh'])
const DEV_ORIGIN = /^http:\/\/(?<host>localhost|127\.0\.0\.1):\d+$/u

// The one route fuda's own pages never call. An ERC-7677 paymaster endpoint is
// fetched by the wallet — for Base Account that is the popup on
// `keys.coinbase.com` — so the fuda allowlist would reject its preflight and the
// wallet would report the transaction as unsponsored. The route defends itself
// instead: it is rate-limited, it pays only for `claim` and `renew` on fuda's
// own registrar, and it carries no credential a browser could replay.
const PAYMASTER_PATH = '/ens/paymaster'

const fudaOrigin = (origin: string): string =>
  PROD_ORIGINS.has(origin) || DEV_ORIGIN.test(origin) ? origin : ''

export const corsPolicy = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const policy = cors({
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    origin: c.req.path === PAYMASTER_PATH ? '*' : fudaOrigin,
  })
  return await policy(c, next)
}
