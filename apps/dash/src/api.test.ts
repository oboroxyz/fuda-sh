import { describe, expect, it, vi } from 'vitest'

import {
  commitLogo,
  issueRight,
  listMembers,
  readStampSettings,
  revokeRight,
  updateDefaultCard,
  updateStampSettings,
  uploadLogo,
} from './api.ts'

const UID = `0x${'ab'.repeat(32)}`
const TOKEN = 's3cret'
const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
// A bodyless GET carries no content-type, so it stays a CORS-simple request.
const GET_HEADERS = { authorization: `Bearer ${TOKEN}` }

// `fetch` is the only thing stubbed: the client is exercised through its real
// request/response handling. A sync stub is fine — the client awaits its result.
const stubFetch = (impl: (url: string, init: RequestInit) => Response) => {
  const spy = vi.fn<(url: string, init: RequestInit) => Response>(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

const json = (body: unknown, status: number): Response => Response.json(body, { status })

describe(listMembers, () => {
  it('GETs /members with the admin token as a bearer credential', async () => {
    const spy = stubFetch(() => json({ members: [] }, 200))
    const result = await listMembers(TOKEN)
    expect(result).toStrictEqual({ body: { members: [] }, ok: true })
    expect(spy).toHaveBeenCalledWith('/api/v1/members', { headers: GET_HEADERS })
  })

  it('maps a 401 to a failure carrying the status, so the dash can ask for the token again', async () => {
    stubFetch(() => json({ error: 'unauthorized' }, 401))
    const result = await listMembers('wrong')
    expect(result).toStrictEqual({ error: 'unauthorized', network: false, ok: false, status: 401 })
  })

  it('treats a 5xx as a network condition, falling back to the status for its message', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 502 }))
    const result = await listMembers(TOKEN)
    expect(result).toStrictEqual({ error: 'api 502', network: true, ok: false, status: 502 })
  })

  it('reports a transport failure with status 0', async () => {
    stubFetch(() => {
      throw new Error('fetch failed')
    })
    const result = await listMembers(TOKEN)
    expect(result).toStrictEqual({ error: 'fetch failed', network: true, ok: false, status: 0 })
  })
})

describe(issueRight, () => {
  it('POSTs /issue with the json body', async () => {
    const body = { memberId: 'alice', tier: 1, usageModel: 1 }
    const spy = stubFetch(() => json({ uid: UID }, 200))
    await issueRight(TOKEN, body)
    expect(spy).toHaveBeenCalledWith('/api/v1/issue', {
      body: JSON.stringify(body),
      headers: HEADERS,
      method: 'POST',
    })
  })

  it('surfaces the api error code verbatim', async () => {
    stubFetch(() => json({ error: 'bad_input' }, 400))
    const result = await issueRight(TOKEN, { holder: '0x00', tier: 1, usageModel: 1 })
    expect(result).toStrictEqual({ error: 'bad_input', network: false, ok: false, status: 400 })
  })
})

describe(revokeRight, () => {
  it('POSTs /revoke with the uid', async () => {
    const spy = stubFetch(() => json({ revoked: true, uid: UID }, 200))
    const result = await revokeRight(TOKEN, UID)
    expect(result).toStrictEqual({ body: { revoked: true, uid: UID }, ok: true })
    expect(spy).toHaveBeenCalledWith('/api/v1/revoke', {
      body: JSON.stringify({ uid: UID }),
      headers: HEADERS,
      method: 'POST',
    })
  })
})

const pngOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

const variants = { logo1x: pngOf(1), logo2x: pngOf(2), logo3x: pngOf(3), master: pngOf(4) }

describe('staging a logo', () => {
  it('POSTs the four variants as multipart, leaving the boundary to the browser', async () => {
    const spy = stubFetch(() => json({ expiresAt: 1_757_000_900, logoUploadId: 'up_1' }, 201))
    const result = await uploadLogo(TOKEN, variants)
    expect(result).toStrictEqual({ body: { expiresAt: 1_757_000_900, logoUploadId: 'up_1' }, ok: true })
    const init = spy.mock.calls[0]?.[1]
    expect(init?.headers).toStrictEqual({ authorization: `Bearer ${TOKEN}` })
    expect(init?.body).toBeInstanceOf(FormData)
  })

  it('sends every variant under its own field name', async () => {
    const spy = stubFetch(() => json({ expiresAt: 1, logoUploadId: 'up_1' }, 201))
    await uploadLogo(TOKEN, variants)
    const body = spy.mock.calls[0]?.[1].body
    const names = body instanceof FormData ? [...body.keys()] : []
    expect(names).toStrictEqual(['master', 'logo1x', 'logo2x', 'logo3x'])
  })

  it('keeps the api error code, so an unconfigured bucket is not read as an outage', async () => {
    stubFetch(() => json({ error: 'media_not_configured' }, 501))
    const result = await uploadLogo(TOKEN, variants)
    expect(result).toStrictEqual({ error: 'media_not_configured', network: false, ok: false, status: 501 })
  })

  it('reports a transport failure with status 0', async () => {
    stubFetch(() => {
      throw new Error('fetch failed')
    })
    const result = await uploadLogo(TOKEN, variants)
    expect(result).toStrictEqual({ error: 'fetch failed', network: true, ok: false, status: 0 })
  })
})

describe('committing a logo', () => {
  it('POSTs the staged id as json', async () => {
    const spy = stubFetch(() => json({ issuer: { handle: 'wassie-coffee' } }, 200))
    const result = await commitLogo(TOKEN, 'up_1')
    expect(result.ok).toBe(true)
    expect(spy).toHaveBeenCalledWith('/api/v1/issuers/logo/commit', {
      body: JSON.stringify({ logoUploadId: 'up_1' }),
      headers: HEADERS,
      method: 'POST',
    })
  })
})

describe('default Card requests', () => {
  it.each(['membership', null] as const)(
    'PUTs slug %s to the authenticated issuer endpoint',
    async (slug) => {
      const issuer = {
        brandColor: '#0073EB',
        createdAt: 1,
        defaultCardSlug: slug,
        handle: 'coffee',
        id: 'issuer',
        logoUrl: null,
        name: 'Coffee',
        operatorAddress: `0x${'ab'.repeat(20)}`,
        tagline: '',
      }
      const spy = stubFetch(() => json({ issuer }, 200))

      await updateDefaultCard(TOKEN, { slug })

      expect(spy).toHaveBeenCalledWith('/api/v1/issuers/me/default-card', {
        body: JSON.stringify({ slug }),
        headers: HEADERS,
        method: 'PUT',
      })
    },
  )
})

describe('Card stamp policy requests', () => {
  it('reads and saves the selected Card without using a venue-wide endpoint', async () => {
    const settings = { dailyLimit: 2, enabled: true, goal: 12 }
    const spy = stubFetch(() => json(settings, 200))
    await expect(readStampSettings(TOKEN, 'card-1')).resolves.toStrictEqual({ body: settings, ok: true })
    expect(spy).toHaveBeenLastCalledWith('/api/v1/issuers/me/cards/card-1/stamps', { headers: GET_HEADERS })
    await updateStampSettings(TOKEN, 'card-2', settings)
    expect(spy).toHaveBeenLastCalledWith('/api/v1/issuers/me/cards/card-2/stamps', {
      body: JSON.stringify(settings),
      headers: HEADERS,
      method: 'PUT',
    })
  })
})
