import { afterEach, describe, expect, it, vi } from 'vitest'

import { listIssuerPasses, readOperatorCard, updateOperatorCard } from './management-api.ts'

describe('operator management requests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('encodes card IDs and sends editable fields through the protected card endpoint', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ card: { id: 'card/1' } }))
    vi.stubGlobal('fetch', fetch)
    await readOperatorCard('session', 'card/1')
    expect(fetch).toHaveBeenCalledWith('/api/v1/issuers/me/cards/card%2F1', {
      headers: { authorization: 'Bearer session' },
    })
    const body = {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      description: 'Updated',
      lockScreen: false,
      title: 'Coffee',
      validFrom: null,
      validUntil: null,
      validityDays: 45,
    } as const
    await updateOperatorCard('session', 'card/1', body)
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/issuers/me/cards/card%2F1', {
      body: JSON.stringify(body),
      headers: { authorization: 'Bearer session', 'content-type': 'application/json' },
      method: 'PUT',
    })
  })

  it('encodes page filters without accepting an issuer identity from the UI', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ passes: [] }))
    vi.stubGlobal('fetch', fetch)
    await listIssuerPasses('session', {
      cardId: 'card/1',
      page: 2,
      pageSize: 25,
      q: 'coffee & tea',
      status: 'active',
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/issuers/me/passes?page=2&pageSize=25&q=coffee+%26+tea&cardId=card%2F1&status=active',
      {
        headers: { authorization: 'Bearer session' },
      },
    )
  })

  it('propagates session failures for the controller to invalidate', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ error: 'unauthorized' }, { status: 401 })),
    )
    await expect(listIssuerPasses('expired', { page: 1, pageSize: 25 })).resolves.toMatchObject({
      ok: false,
      status: 401,
    })
  })
})
