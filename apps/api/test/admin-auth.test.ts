import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import type { AppEnv } from '../src/env.ts'
import { adminAuth } from '../src/middleware/admin-auth.ts'
import { testEnv } from './env.ts'

const guarded = () => new Hono<AppEnv>().get('/admin', adminAuth(), (c) => c.json({ ok: true }))

describe(adminAuth, () => {
  it('rejects a missing or wrong token when ADMIN_TOKEN is set', async () => {
    const app = guarded()
    const env = testEnv({ ADMIN_TOKEN: 'secret' })
    const missing = await app.request('/admin', {}, env)
    expect(missing.status).toBe(401)
    const wrong = await app.request('/admin', { headers: { Authorization: 'Bearer nope' } }, env)
    expect(wrong.status).toBe(401)
    await expect(wrong.json()).resolves.toStrictEqual({ error: 'unauthorized' })
  })

  it('admits the right token', async () => {
    const res = await guarded().request(
      '/admin',
      { headers: { Authorization: 'Bearer secret' } },
      testEnv({ ADMIN_TOKEN: 'secret' }),
    )
    expect(res.status).toBe(200)
  })

  it('is open with x-auth-mode: open when ADMIN_TOKEN is unset', async () => {
    const res = await guarded().request('/admin', {}, testEnv({ ADMIN_TOKEN: undefined }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-auth-mode')).toBe('open')
  })
})
