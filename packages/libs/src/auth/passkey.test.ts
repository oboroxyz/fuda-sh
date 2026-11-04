import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { passkeyClient } from './passkey.ts'
import type { PasskeyTransport } from './passkey.ts'

vi.mock(import('@simplewebauthn/browser'), async (original) => ({
  ...(await original()),
  startAuthentication: vi.fn<typeof startAuthentication>(),
  startRegistration: vi.fn<typeof startRegistration>(),
}))

const OPTIONS = { body: { challenge: 'c' }, ok: true as const }
const refused = (status: number, network = false) => ({ error: 'no', network, ok: false as const, status })

const transport = (over: Partial<PasskeyTransport> = {}) => {
  const api = vi.fn<(path: string) => Promise<unknown>>().mockResolvedValue(OPTIONS)
  const session = vi
    .fn<(url: string) => Promise<unknown>>()
    .mockResolvedValue({ body: { issuer: null }, ok: true })
  // SAFETY: the mocks answer the Result shape each test reads, whatever T the client asks for.
  return { api, session, ...over } as unknown as PasskeyTransport & {
    api: typeof api
    session: typeof session
  }
}

describe(passkeyClient, () => {
  beforeEach(() => {
    vi.mocked(startAuthentication).mockReset()
    vi.mocked(startRegistration).mockReset()
  })

  it.each(['member', 'operator'] as const)('runs a sign-in under the %s routes', async (audience) => {
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'cred' } as never)
    const io = transport()
    const outcome = await passkeyClient(audience, io).signIn()
    expect(outcome).toStrictEqual({ ok: true, session: { issuer: null } })
    expect(io.api.mock.calls[0]?.[0]).toBe(`/auth/${audience}/login/options`)
    expect(io.session).toHaveBeenCalledExactlyOnceWith('/session/passkey', {
      body: JSON.stringify({ flow: 'login', response: { id: 'cred' } }),
      method: 'POST',
    })
  })

  it('reads a dismissed prompt as cancelled and spends nothing', async () => {
    vi.mocked(startRegistration).mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const io = transport()
    await expect(passkeyClient('operator', io).create()).resolves.toStrictEqual({
      failure: 'cancelled',
      ok: false,
    })
    expect(io.session).not.toHaveBeenCalled()
  })

  it.each([
    [refused(401), 'rejected'],
    [refused(400), 'rejected'],
    [refused(500), 'unavailable'],
    [refused(0, true), 'network'],
  ])('maps a refused ceremony %j to %s', async (result, failure) => {
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'cred' } as never)
    const io = transport()
    io.session.mockResolvedValue(result)
    await expect(passkeyClient('operator', io).signIn()).resolves.toStrictEqual({ failure, ok: false })
  })

  it('reports the passkey limit when adding', async () => {
    vi.mocked(startRegistration).mockResolvedValue({ id: 'cred' } as never)
    const io = transport()
    io.api.mockResolvedValueOnce(OPTIONS).mockResolvedValueOnce(refused(409))
    await expect(passkeyClient('operator', io).add()).resolves.toStrictEqual({ failure: 'limit', ok: false })
  })

  it('encodes the id it removes', async () => {
    const io = transport()
    await expect(passkeyClient('operator', io).remove('a/b')).resolves.toBe(true)
    expect(io.api.mock.calls[0]?.[0]).toBe('/auth/operator/passkeys/a%2Fb')
  })
})
