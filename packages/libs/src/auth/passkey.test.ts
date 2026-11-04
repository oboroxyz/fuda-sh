import type { ApiInit } from '@fuda/sdk/http'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import * as v from 'valibot'
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
  const api = vi.fn<(path: string, init?: ApiInit) => Promise<unknown>>().mockResolvedValue(OPTIONS)
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
    io.api
      .mockResolvedValueOnce({ body: { passkeys: [] }, ok: true })
      .mockResolvedValueOnce(OPTIONS)
      .mockResolvedValueOnce(refused(409))
    await expect(passkeyClient('operator', io).add()).resolves.toStrictEqual({ failure: 'limit', ok: false })
  })

  it('encodes the id it removes', async () => {
    const io = transport()
    await expect(passkeyClient('operator', io).remove('a/b')).resolves.toBe(true)
    expect(io.api.mock.calls[0]?.[0]).toBe('/auth/operator/passkeys/a%2Fb')
  })
})

describe('authorizing additional operator passkeys', () => {
  it('confirms an existing passkey before registering and submits its assertion', async () => {
    const authorization = { id: 'existing' } as never
    vi.mocked(startAuthentication).mockResolvedValue(authorization)
    vi.mocked(startRegistration).mockResolvedValue({ id: 'new' } as never)
    const io = transport()
    io.api
      .mockResolvedValueOnce({ body: { passkeys: [{ id: 'existing' }] }, ok: true })
      .mockResolvedValueOnce(OPTIONS)
      .mockResolvedValueOnce(OPTIONS)
      .mockResolvedValueOnce({ body: { added: true }, ok: true })
    await expect(passkeyClient('operator', io).add()).resolves.toStrictEqual({ ok: true })
    expect(io.api.mock.calls.map(([path]) => path)).toStrictEqual([
      '/auth/operator/passkeys',
      '/auth/operator/passkeys/authorize/options',
      '/auth/operator/passkeys/options',
      '/auth/operator/passkeys',
    ])
    const submitted = io.api.mock.calls.at(-1)?.[1]?.body
    expect(JSON.parse(v.parse(v.string(), submitted))).toStrictEqual({
      authorization,
      id: 'new',
    })
  })

  it('stops before creating a new key when the confirmation is dismissed', async () => {
    vi.mocked(startAuthentication).mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    vi.mocked(startRegistration).mockClear()
    const io = transport()
    io.api
      .mockResolvedValueOnce({ body: { passkeys: [{ id: 'existing' }] }, ok: true })
      .mockResolvedValueOnce(OPTIONS)
    await expect(passkeyClient('operator', io).add()).resolves.toStrictEqual({
      failure: 'cancelled',
      ok: false,
    })
    expect(startRegistration).not.toHaveBeenCalled()
    expect(io.api).toHaveBeenCalledTimes(2)
  })
})
