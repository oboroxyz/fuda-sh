import { describe, expect, it, vi } from 'vitest'

import { verifyTurnstile } from './siteverify.ts'
import type { SiteverifyFetch } from './siteverify.ts'

const answer =
  (body: Record<string, boolean | string | string[]>, status = 200): SiteverifyFetch =>
  async () =>
    await Promise.resolve(Response.json(body, { status }))

const check = async (fetcher: SiteverifyFetch, token: string | null = 'token-1') =>
  await verifyTurnstile({ fetcher, ip: '203.0.113.7', secret: 'secret-1', token })

describe(verifyTurnstile, () => {
  it('posts the secret, the token and the visitor ip as a form to Siteverify', async () => {
    const fetcher = vi.fn<SiteverifyFetch>(answer({ action: 'claim', success: true }))
    await check(fetcher)
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init?.method).toBe('POST')
    expect(init?.body.toString()).toBe('remoteip=203.0.113.7&response=token-1&secret=secret-1')
  })

  it('passes a successful claim token', async () => {
    await expect(check(answer({ action: 'claim', success: true }))).resolves.toBe('passed')
  })

  it('fails a rejected, expired or reused token', async () => {
    await expect(check(answer({ 'error-codes': ['timeout-or-duplicate'], success: false }))).resolves.toBe(
      'failed',
    )
  })

  it('fails a token minted for another action', async () => {
    await expect(check(answer({ action: 'login', success: true }))).resolves.toBe('failed')
  })

  it('fails a missing or oversized token without asking Siteverify', async () => {
    const fetcher = vi.fn<SiteverifyFetch>()
    await expect(check(fetcher, null)).resolves.toBe('failed')
    await expect(check(fetcher, '')).resolves.toBe('failed')
    await expect(check(fetcher, 'x'.repeat(2049))).resolves.toBe('failed')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('is unavailable when Siteverify errors, times out or answers nonsense', async () => {
    await expect(check(async () => await Promise.reject(new Error('network down')))).resolves.toBe(
      'unavailable',
    )
    await expect(check(answer({}, 502))).resolves.toBe('unavailable')
    await expect(
      check(async () => await Promise.resolve(new Response('<html>', { status: 200 }))),
    ).resolves.toBe('unavailable')
    await expect(check(answer({ unrelated: true }))).resolves.toBe('unavailable')
  })

  it('is unavailable when our secret is refused, since no new token can fix that', async () => {
    await expect(check(answer({ 'error-codes': ['invalid-input-secret'], success: false }))).resolves.toBe(
      'unavailable',
    )
    await expect(check(answer({ 'error-codes': ['internal-error'], success: false }))).resolves.toBe(
      'unavailable',
    )
  })
})
