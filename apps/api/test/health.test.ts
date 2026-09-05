import { describe, expect, it } from 'vitest'

import { appWith, testEnv } from './env.ts'

describe('GET /health', () => {
  it('answers { ok: true }', async () => {
    const app = appWith({ chain: {} })
    const res = await app.request('/health', {}, testEnv())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({ ok: true })
  })
})
