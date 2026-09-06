import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import type { AppEnv } from '../src/env.ts'
import { adminAuth } from '../src/middleware/admin-auth.ts'
import { appWith, fakeChain, testEnv } from './env.ts'

const guarded = () => new Hono<AppEnv>().get('/admin', adminAuth(), (c) => c.json({ ok: true }))

// Never used to sign: the guard reads the binding's presence, not its value.
const SIGNER = `0x${'11'.repeat(32)}`

const lockedEnv = () => testEnv({ ADMIN_TOKEN: undefined, SIGNER_PRIVATE_KEY: SIGNER })

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

  it('is open with x-auth-mode: open when ADMIN_TOKEN and the signer are both unset', async () => {
    const res = await guarded().request(
      '/admin',
      {},
      testEnv({ ADMIN_TOKEN: undefined, SIGNER_PRIVATE_KEY: undefined }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-auth-mode')).toBe('open')
  })

  it('locks the route when a signer is configured without ADMIN_TOKEN', async () => {
    const res = await guarded().request('/admin', {}, lockedEnv())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toStrictEqual({ error: 'unauthorized' })
  })

  it('locks the route when only BASE_RPC_URL is configured without ADMIN_TOKEN', async () => {
    const env = testEnv({
      ADMIN_TOKEN: undefined,
      BASE_RPC_URL: 'https://sepolia.base.org',
      SIGNER_PRIVATE_KEY: undefined,
    })
    const res = await guarded().request('/admin', {}, env)
    expect(res.status).toBe(401)
  })

  it('never locks a route while ADMIN_TOKEN is set, signer or not', async () => {
    const env = testEnv({ ADMIN_TOKEN: 'secret', SIGNER_PRIVATE_KEY: SIGNER })
    const ok = await guarded().request('/admin', { headers: { Authorization: 'Bearer secret' } }, env)
    expect(ok.status).toBe(200)
    const wrong = await guarded().request('/admin', { headers: { Authorization: 'Bearer nope' } }, env)
    expect(wrong.status).toBe(401)
  })
})

describe('the fail-closed guard on the real app', () => {
  it('answers 401 unauthorized with x-auth-mode: locked on POST /issue', async () => {
    const res = await appWith({ chain: fakeChain() }).request(
      '/issue',
      {
        body: JSON.stringify({ holder: `0x${'22'.repeat(20)}` }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
      lockedEnv(),
    )
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toStrictEqual({ error: 'unauthorized' })
    expect(res.headers.get('x-auth-mode')).toBe('locked')
  })

  it('stamps x-auth-mode: locked on an unrelated route such as GET /health', async () => {
    const res = await appWith({ chain: fakeChain() }).request('/health', {}, lockedEnv())
    expect(res.status).toBe(200)
    expect(res.headers.get('x-auth-mode')).toBe('locked')
  })

  it('leaves GET /health on x-auth-mode: open when no signer is configured', async () => {
    const res = await appWith({ chain: fakeChain() }).request(
      '/health',
      {},
      testEnv({ ADMIN_TOKEN: undefined }),
    )
    expect(res.headers.get('x-auth-mode')).toBe('open')
  })
})
