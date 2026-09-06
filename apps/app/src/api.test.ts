import type { Hex, VerifyResponse } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import { challenge, verifySigned, verifyUid } from './api.ts'

const UID: Hex = `0x${'ab'.repeat(32)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`
const SIGNATURE: Hex = `0x${'11'.repeat(65)}`

const stubFetch = (impl: (url: string, init: RequestInit) => Response) => {
  const spy = vi.fn<(url: string, init: RequestInit) => Response>(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

const json = (body: unknown, status: number): Response => Response.json(body, { status })

describe(challenge, () => {
  it('POSTs /challenge with the uid and returns the minted challenge', async () => {
    const body = { challenge: `fuda-gate:${UID}:${NONCE}`, nonce: NONCE }
    const spy = stubFetch(() => json(body, 200))
    const result = await challenge(UID)
    expect(result).toStrictEqual({ body, ok: true })
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/challenge', {
      body: JSON.stringify({ uid: UID }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('maps a 4xx error body to a non-network failure', async () => {
    stubFetch(() => json({ error: 'bad_uid' }, 400))
    const result = await challenge(UID)
    expect(result).toStrictEqual({ error: 'bad_uid', network: false, ok: false, status: 400 })
  })
})

describe(verifySigned, () => {
  const body = { nonce: NONCE, signature: SIGNATURE, uid: UID }

  it('POSTs /verify-signed with uid, nonce and signature', async () => {
    const verdict = { decision: 'ADMIT', path: 'signature', reason: 'OK' }
    const spy = stubFetch(() => json(verdict, 200))
    const result = await verifySigned(body)
    expect(result).toStrictEqual({ body: verdict, ok: true })
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/verify-signed', {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('treats a 5xx as a network condition', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 502 }))
    const result = await verifySigned(body)
    expect(result).toStrictEqual({ error: 'api 502', network: true, ok: false, status: 502 })
  })

  it('treats a transport failure as a network condition', async () => {
    stubFetch(() => {
      throw new Error('fetch failed')
    })
    const result = await verifySigned(body)
    expect(result).toStrictEqual({ error: 'fetch failed', network: true, ok: false, status: 0 })
  })
})

describe(verifyUid, () => {
  it('GETs the uid preview without a request body', async () => {
    const body: VerifyResponse = { decision: 'ADMIT', reason: 'OK' }
    const spy = stubFetch(() => json(body, 200))

    await expect(verifyUid(UID)).resolves.toStrictEqual({ body, ok: true })
    expect(spy).toHaveBeenCalledWith(`http://localhost:8787/verify/${UID}`, { headers: {}, method: 'GET' })
  })
})
