import { describe, expect, it } from 'vitest'

import { appWith, fakeChain, testEnv } from './env.ts'

describe('GET /health', () => {
  it('answers { ok: true }', async () => {
    const app = appWith({ chain: fakeChain() })
    const res = await app.request('/health', {}, testEnv())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({ ok: true })
  })

  it('does not expose the removed announcement-cache route', async () => {
    const app = appWith({ chain: fakeChain() })
    const res = await app.request('/announcements', {}, testEnv())
    expect(res.status).toBe(404)
  })
})
