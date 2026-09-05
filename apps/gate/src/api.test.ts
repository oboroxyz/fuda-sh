import { describe, expect, it, vi } from 'vitest'

import { admitQr, previewUid } from './api.ts'

const UID = `0x${'ab'.repeat(32)}`
const ADMIT = { decision: 'ADMIT', reason: 'OK' }

// `fetch` is the only thing stubbed: the client is exercised through its real
// request/response handling. A sync stub is fine — `call` awaits its result.
const stubFetch = (impl: (url: string, init: RequestInit) => Response) => {
  const spy = vi.fn<(url: string, init: RequestInit) => Response>(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

const json = (body: unknown, status: number): Response => Response.json(body, { status })

describe(previewUid, () => {
  it('GETs /verify/:uid and returns the body', async () => {
    const spy = stubFetch(() => json(ADMIT, 200))
    const result = await previewUid(UID)
    expect(result).toStrictEqual({ body: ADMIT, ok: true })
    expect(spy).toHaveBeenCalledWith(`http://localhost:8787/verify/${UID}`, { method: 'GET' })
  })

  it('maps a 4xx error body to a non-network failure', async () => {
    stubFetch(() => json({ error: 'bad_uid' }, 400))
    const result = await previewUid('nope')
    expect(result).toStrictEqual({ error: 'bad_uid', network: false, ok: false })
  })
})

describe(admitQr, () => {
  it('POSTs /verify with the qr payload', async () => {
    const spy = stubFetch(() => json(ADMIT, 200))
    const result = await admitQr(`fuda:v1:${UID}`)
    expect(result).toStrictEqual({ body: ADMIT, ok: true })
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/verify', {
      body: JSON.stringify({ qr: `fuda:v1:${UID}` }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('treats a 5xx as a network condition without reading the body', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 502 }))
    const result = await admitQr(`fuda:v1:${UID}`)
    expect(result).toStrictEqual({ error: 'api 502', network: true, ok: false })
  })

  it('treats a transport failure as a network condition', async () => {
    stubFetch(() => {
      throw new Error('fetch failed')
    })
    const result = await admitQr(`fuda:v1:${UID}`)
    expect(result).toStrictEqual({ error: 'fetch failed', network: true, ok: false })
  })
})
