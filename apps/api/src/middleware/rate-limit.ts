import { and, eq, sql } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'

import { rateLimits } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'

// requests / hour / IP
export const DEFAULT_BUDGET = 120
const WINDOW = 3600

// Fixed hourly window on D1: floor(now / 3600) * 3600. Upsert-and-read so two
// concurrent requests both see the incremented count.
export const rateLimit =
  (opts: { budget: number }): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP')
    if (ip === undefined || ip === '') {
      return c.json({ error: 'client_ip_required' }, 400)
    }
    const windowStart = Math.floor(c.get('now')() / WINDOW) * WINDOW
    const db = c.get('db')
    await db
      .insert(rateLimits)
      .values({ count: 1, ip, windowStart })
      .onConflictDoUpdate({
        set: { count: sql`${rateLimits.count} + 1` },
        target: [rateLimits.ip, rateLimits.windowStart],
      })
    const row = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(and(eq(rateLimits.ip, ip), eq(rateLimits.windowStart, windowStart)))
      .get()
    if (row !== undefined && row.count > opts.budget) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    await next()
  }
