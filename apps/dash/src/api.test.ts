import { describe, expect, it, vi } from 'vitest'

import { issueRight, listMembers, revokeRight } from './api.ts'

const UID = `0x${'ab'.repeat(32)}`
const TOKEN = 's3cret'
const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

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
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/members', { headers: HEADERS })
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
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/issue', {
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
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/revoke', {
      body: JSON.stringify({ uid: UID }),
      headers: HEADERS,
      method: 'POST',
    })
  })
})
