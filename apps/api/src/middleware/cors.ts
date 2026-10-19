import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

import { isRegisteredOrigin } from '../connected-apps/store.ts'
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

// The routes a connected app calls from its own page
// (docs/specs/connected-apps.md#cors). The approval itself is not among them:
// it is fuda's dashboard that calls /oauth/authorize, never the app.
const CONNECTED_APP_PATH = /^\/v1\/(?:oauth\/(?:token|revoke)$|connect(?:\/|$))/u

// Where Figma Make publishes a site. Allowing the pattern lets such a page read
// fuda's answers before its own origin is registered; the token endpoint and
// the resource routes still accept only the registered origins of the app the
// code or token belongs to.
const FIGMA_MAKE_ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.figma\.site$/u

const fudaOrigin = (origin: string): string =>
  PROD_ORIGINS.has(origin) || DEV_ORIGIN.test(origin) ? origin : ''

export const corsPolicy = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const connected = CONNECTED_APP_PATH.test(c.req.path)
  const policy = cors({
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    origin:
      c.req.path === PAYMASTER_PATH
        ? '*'
        : async (origin) => {
            if (fudaOrigin(origin) !== '' || !connected || origin === '') {
              return fudaOrigin(origin)
            }
            return FIGMA_MAKE_ORIGIN.test(origin) || (await isRegisteredOrigin(c.get('db'), origin))
              ? origin
              : ''
          },
  })
  return await policy(c, next)
}
