import type { Hex, VerifyResponse } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  cardFailureOf,
  challenge,
  fetchVenue,
  googleSaveUrl,
  issueCard,
  verifySigned,
  verifyUid,
} from './api.ts'

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
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/v1/challenge', {
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
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/v1/verify-signed', {
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
    expect(spy).toHaveBeenCalledWith(`http://localhost:8787/v1/verify/${UID}`, { headers: {}, method: 'GET' })
  })
})

describe(fetchVenue, () => {
  it('GETs the venue and every card it publishes, without a request body', async () => {
    const body = {
      brandColor: '#1D4ED8',
      cards: [
        {
          category: 'membership',
          id: 'c1',
          perk: '',
          reward: '',
          slug: 'regular',
          title: 'Regular',
          validityDays: null,
        },
      ],
      handle: 'wassie-coffee',
      name: 'Wassie Coffee',
      tagline: '',
    }
    const spy = stubFetch(() => json(body, 200))

    await expect(fetchVenue('wassie-coffee')).resolves.toStrictEqual({ body, ok: true })
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/v1/issuers/wassie-coffee', {
      headers: {},
      method: 'GET',
    })
  })

  it('reports an unknown handle as not_found', async () => {
    stubFetch(() => json({ error: 'not_found' }, 404))

    await expect(fetchVenue('nobody')).resolves.toStrictEqual({
      error: 'not_found',
      network: false,
      ok: false,
      status: 404,
    })
  })
})

describe(issueCard, () => {
  it('POSTs the self-serve issue for one card slug, without a body', async () => {
    const spy = stubFetch(() => json({ uid: UID }, 200))

    await expect(issueCard('wassie-coffee', 'regular')).resolves.toStrictEqual({
      body: { uid: UID },
      ok: true,
    })
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/v1/issuers/wassie-coffee/regular/issue', {
      headers: {},
      method: 'POST',
    })
  })

  it('keeps the 429 rate_limited code from the api', async () => {
    stubFetch(() => json({ error: 'rate_limited' }, 429))

    await expect(issueCard('wassie-coffee', 'regular')).resolves.toStrictEqual({
      error: 'rate_limited',
      network: false,
      ok: false,
      status: 429,
    })
  })
})

describe(cardFailureOf, () => {
  it('maps the api status to the card failure, telling 501 and 502 apart', () => {
    expect(cardFailureOf({ error: 'not_found', status: 404 })).toBe('not_found')
    expect(cardFailureOf({ error: 'rate_limited', status: 429 })).toBe('rate_limited')
    expect(cardFailureOf({ error: 'api 501', status: 501 })).toBe('no_signer')
    expect(cardFailureOf({ error: 'api 502', status: 502 })).toBe('chain_error')
    expect(cardFailureOf({ error: 'fetch failed', status: 0 })).toBe('network')
  })
})

describe(googleSaveUrl, () => {
  it('returns the save link on 200 and null on 501 google_not_configured', async () => {
    stubFetch(() => json({ saveUrl: 'https://pay.google.com/gp/v/save' }, 200))
    await expect(googleSaveUrl('http://localhost:8787/pass/x/google')).resolves.toBe(
      'https://pay.google.com/gp/v/save',
    )

    stubFetch(() => json({ error: 'google_not_configured' }, 501))
    await expect(googleSaveUrl('http://localhost:8787/pass/x/google')).resolves.toBeNull()
  })
})
