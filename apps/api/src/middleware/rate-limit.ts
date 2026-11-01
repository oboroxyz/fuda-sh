import { and, eq, sql } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'

import type { Db } from '../db/client.ts'
import { rateLimits } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'

// requests / hour / IP
export const DEFAULT_BUDGET = 120
const WINDOW = 3600

interface RateLimitOptions {
  budget: number
  response?: 'default' | 'eip3668'
}

const budgetError = (
  response: RateLimitOptions['response'],
  kind: 'client_ip_required' | 'rate_limited',
): { error: string } | { message: string } => {
  if (response === 'eip3668') {
    return {
      message: kind === 'client_ip_required' ? 'Client IP required.' : 'Rate limit exceeded.',
    }
  }
  return { error: kind }
}

// Fixed hourly window on D1: floor(now / 3600) * 3600. Upsert-and-read so two
// concurrent requests both see the incremented count. True while `key` is within
// `budget` for the hour. A key is a client IP, or a named budget of one issuer.
export const spendBudget = async (db: Db, key: string, now: number, budget: number): Promise<boolean> => {
  const windowStart = Math.floor(now / WINDOW) * WINDOW
  await db
    .insert(rateLimits)
    .values({ count: 1, ip: key, windowStart })
    .onConflictDoUpdate({
      set: { count: sql`${rateLimits.count} + 1` },
      target: [rateLimits.ip, rateLimits.windowStart],
    })
  const row = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.ip, key), eq(rateLimits.windowStart, windowStart)))
    .get()
  return row === undefined || row.count <= budget
}

export const rateLimit =
  (opts: RateLimitOptions): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP')
    if (ip === undefined || ip === '') {
      if (opts.response === 'eip3668') {
        c.header('cache-control', 'no-store')
      }
      return c.json(budgetError(opts.response, 'client_ip_required'), 400)
    }
    if (!(await spendBudget(c.get('db'), ip, c.get('now')(), opts.budget))) {
      if (opts.response === 'eip3668') {
        c.header('cache-control', 'no-store')
      }
      return c.json(budgetError(opts.response, 'rate_limited'), 429)
    }
    await next()
  }
