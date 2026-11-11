import type { Hex, VerifyResponse } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  applyAddressCard,
  issueAddressCard,
  cardFailureOf,
  claimSourceFrom,
  challenge,
  fetchVenue,
  googleSaveUrl,
  issueCard,
  issueSensitiveCard,
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
    expect(spy).toHaveBeenCalledWith('/api/v1/challenge', {
      body: JSON.stringify({ uid: UID }),
      credentials: 'omit',
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
    expect(spy).toHaveBeenCalledWith('/api/v1/verify-signed', {
      body: JSON.stringify(body),
      credentials: 'omit',
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
    expect(spy).toHaveBeenCalledWith(`/api/v1/verify/${UID}`, { headers: {}, method: 'GET' })
  })
})

describe(fetchVenue, () => {
  it('GETs the venue and every card it publishes, without a request body', async () => {
    const body = {
      brandColor: '#1D4ED8',
      cards: [
        {
          category: 'membership',
          description: '',
          id: 'c1',
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
    expect(spy).toHaveBeenCalledWith('/api/v1/issuers/wassie-coffee', {
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

    await expect(issueCard('wassie-coffee', 'regular', null)).resolves.toStrictEqual({
      body: { uid: UID },
      ok: true,
    })
    expect(spy).toHaveBeenCalledWith('/api/v1/issuers/wassie-coffee/regular/issue', {
      headers: {},
      method: 'POST',
    })
  })

  it('sends the claim link label when there is one', async () => {
    const spy = stubFetch(() => json({ uid: UID }, 200))
    await issueCard('wassie-coffee', 'regular', 'spring-flyer')
    expect(spy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ source: 'spring-flyer' }))
  })

  it('sends the Turnstile token with the claim, alone or beside the label', async () => {
    const spy = stubFetch(() => json({ uid: UID }, 200))
    await issueCard('wassie-coffee', 'regular', null, 'token-1')
    await issueCard('wassie-coffee', 'regular', 'spring-flyer', 'token-2')
    expect(spy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ turnstileToken: 'token-1' }))
    expect(spy.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ source: 'spring-flyer', turnstileToken: 'token-2' }),
    )
  })

  it('keeps only a claim link label the api would accept', () => {
    expect(claimSourceFrom('?source=spring-flyer')).toBe('spring-flyer')
    expect(claimSourceFrom('?source=Not%20Valid')).toBeNull()
    expect(claimSourceFrom('')).toBeNull()
  })

  it('tells a failed bot check from any other 403', () => {
    expect(cardFailureOf({ error: 'bot_check_failed', status: 403 })).toBe('bot_check_failed')
    expect(cardFailureOf({ error: 'forbidden', status: 403 })).toBe('passkey_refused')
  })

  it('tells a card with no places left from a closed one', () => {
    expect(cardFailureOf({ error: 'card_sold_out', status: 409 })).toBe('card_sold_out')
    expect(cardFailureOf({ error: 'card_closed', status: 409 })).toBe('card_closed')
  })

  it('keeps the 429 rate_limited code from the api', async () => {
    stubFetch(() => json({ error: 'rate_limited' }, 429))

    await expect(issueCard('wassie-coffee', 'regular', null)).resolves.toStrictEqual({
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

describe('Sensitive request privacy', () => {
  it('omits cookies and credentials on Sensitive claims and presentation requests', async () => {
    const captured: RequestInit[] = []
    stubFetch((_url, init) => {
      captured.push(init)
      return json({}, 200)
    })
    await issueSensitiveCard('venue-one', 'staff', null, `0x${'11'.repeat(20)}`, 'sensitive-token')
    await issueSensitiveCard('venue-two', 'staff', null, `0x${'22'.repeat(20)}`)
    await challenge(UID)
    await verifySigned({ nonce: NONCE, signature: SIGNATURE, uid: UID })
    expect(captured).toHaveLength(4)
    expect(JSON.parse(await new Response(captured[0]?.body).text())).toMatchObject({
      turnstileToken: 'sensitive-token',
    })
    for (const request of captured) {
      expect(request.credentials).toBe('omit')
      expect([...new Headers(request.headers).keys()]).toStrictEqual(['content-type'])
    }
  })
})

describe('address card requests', () => {
  it('applies without account credentials and with only the public address and bot token', async () => {
    const spy = stubFetch(() => json({ applied: true }, 200))
    await applyAddressCard('art club', 'fan pass', UID, 'bot')
    expect(spy).toHaveBeenCalledWith('/api/v1/issuers/art%20club/fan%20pass/apply', {
      body: JSON.stringify({ holderAddress: UID, turnstileToken: 'bot' }),
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('claims with a signature, omits optional values and preserves the requirement detail', async () => {
    const requirement = { detail: 'wrong-terms', kind: 'erc8432-agreement' }
    const spy = stubFetch(() => json({ error: 'requirement_unmet', requirement }, 403))
    const result = await issueAddressCard('art', 'fan', UID, SIGNATURE, null, null)
    expect(result).toStrictEqual({
      error: 'requirement_unmet',
      network: false,
      ok: false,
      requirement,
      status: 403,
    })
    expect(spy).toHaveBeenCalledWith('/api/v1/issuers/art/fan/issue', {
      body: JSON.stringify({ holderAddress: UID, signature: SIGNATURE }),
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  })
})
