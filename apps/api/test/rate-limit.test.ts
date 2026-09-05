import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { rateLimits } from '../src/db/schema.ts'
import type { AppEnv } from '../src/env.ts'
import { rateLimit } from '../src/middleware/rate-limit.ts'
import { testEnv } from './env.ts'

const budgeted = (now: number) =>
  new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('db', getDb(c.env))
      c.set('now', () => now)
      await next()
    })
    .get('/limited', rateLimit({ budget: 3 }), (c) => c.json({ ok: true }))

const hit = async (now: number, ip = '203.0.113.7') =>
  await budgeted(now).request('/limited', { headers: { 'CF-Connecting-IP': ip } }, testEnv())

describe(rateLimit, () => {
  // Storage is shared across the tests in this file, so the one table this file
  // writes starts empty for every test.
  beforeEach(async () => {
    await getDb({ DB: env.DB }).delete(rateLimits)
  })

  it('400s without a client IP', async () => {
    const res = await budgeted(1_000_000).request('/limited', {}, testEnv())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'client_ip_required' })
  })

  it('allows `budget` requests per IP per hour, then 429s', async () => {
    const t = 7200
    const first = await hit(t)
    const second = await hit(t + 1)
    const third = await hit(t + 2)
    const over = await hit(t + 3)
    expect([first.status, second.status, third.status, over.status]).toStrictEqual([200, 200, 200, 429])
    await expect(over.json()).resolves.toStrictEqual({ error: 'rate_limited' })
  })

  it('tracks the budget per IP and resets on the next window', async () => {
    const t = 7200
    await hit(t)
    await hit(t + 1)
    await hit(t + 2)
    await hit(t + 3)
    const otherIp = await hit(t + 3, '198.51.100.1')
    const nextWindow = await hit(t + 3600)
    expect([otherIp.status, nextWindow.status]).toStrictEqual([200, 200])
  })
})
