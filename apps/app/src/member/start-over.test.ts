import * as webauthn from '@simplewebauthn/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MEMBER_COPY } from './copy.ts'
import { startSecretOver } from './sensitive.ts'

vi.mock(import('@simplewebauthn/browser'), async (importOriginal) => ({
  ...(await importOriginal()),
  startAuthentication: vi.fn<typeof webauthn.startAuthentication>(),
}))

describe('Start over warning', () => {
  it('tells English readers old passes remain usable and the shop cancels them', () => {
    expect(MEMBER_COPY.en.sensitive.startOverWarning).toContain('does not cancel')
    expect(MEMBER_COPY.en.sensitive.startOverWarning).toContain('ask the shop')
  })

  it('tells Japanese readers old passes remain usable and the shop cancels them', () => {
    expect(MEMBER_COPY.ja.sensitive.startOverWarning).toContain('無効にはなりません')
    expect(MEMBER_COPY.ja.sensitive.startOverWarning).toContain('お店や組織に依頼')
  })
})

describe('Start over confirmation and local keys', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([true, false])(
    'clears local pending keys only after a confirmed reset, success=%s',
    async (success) => {
      const items = new Map([
        ['fuda.sensitive.pending.v1.first', 'sealed-first'],
        ['fuda.sensitive.pending.v1.second', 'sealed-second'],
        ['fuda.passes.v1', 'unrelated-pass'],
      ])
      vi.stubGlobal('localStorage', {
        key: (index: number) => [...items.keys()][index] ?? null,
        get length() {
          return items.size
        },
        removeItem: (key: string) => {
          items.delete(key)
        },
      })
      const assertion: webauthn.AuthenticationResponseJSON = {
        clientExtensionResults: {},
        id: 'own-passkey',
        rawId: 'own-passkey',
        response: { authenticatorData: 'data', clientDataJSON: 'client', signature: 'signature' },
        type: 'public-key',
      }
      vi.mocked(webauthn.startAuthentication).mockResolvedValue(assertion)
      const sent: { body: string; method: string; url: string }[] = []
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        sent.push({ body: await new Response(init.body).text(), method: init.method ?? 'GET', url })
        if (url.endsWith('/reset/options')) {
          return Response.json({ challenge: 'fresh-reset', rpId: 'fuda.sh' })
        }
        return success
          ? Response.json({ cleared: true })
          : Response.json({ error: 'bad_passkey' }, { status: 403 })
      })
      await expect(startSecretOver()).resolves.toBe(success)
      expect(sent).toStrictEqual([
        { body: '{}', method: 'POST', url: '/api/v1/member/secret/reset/options' },
        { body: JSON.stringify(assertion), method: 'DELETE', url: '/api/v1/member/secret' },
      ])
      expect(items.has('fuda.sensitive.pending.v1.first')).toBe(!success)
      expect(items.has('fuda.sensitive.pending.v1.second')).toBe(!success)
      expect(items.get('fuda.passes.v1')).toBe('unrelated-pass')
    },
  )

  it('does not request deletion if the passkey prompt is canceled', async () => {
    const fetch = vi.fn<(url: string) => Response>(() =>
      Response.json({ challenge: 'fresh-reset', rpId: 'fuda.sh' }),
    )
    vi.stubGlobal('fetch', fetch)
    vi.mocked(webauthn.startAuthentication).mockRejectedValue(new Error('canceled'))
    await expect(startSecretOver()).resolves.toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
