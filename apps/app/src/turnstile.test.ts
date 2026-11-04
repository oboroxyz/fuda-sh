// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { requestClaimToken } from './turnstile.ts'
import type { TurnstileApi } from './turnstile.ts'

type Options = Parameters<TurnstileApi['render']>[1]

const fakeApi = (run: (options: Options) => void): TurnstileApi => ({
  remove: vi.fn<TurnstileApi['remove']>(),
  render: vi.fn<TurnstileApi['render']>((_container, options) => {
    queueMicrotask(() => {
      run(options)
    })
    return 'widget-1'
  }),
})

const container = (): HTMLElement => document.createElement('div')

describe(requestClaimToken, () => {
  it('renders a claim widget with the site key and resolves with its token', async () => {
    const api = fakeApi((options) => {
      options.callback('tok-1')
    })
    const host = container()
    await expect(
      requestClaimToken('site-key', host, async () => await Promise.resolve(api)),
    ).resolves.toStrictEqual({
      ok: true,
      token: 'tok-1',
    })
    expect(api.render).toHaveBeenCalledWith(
      host,
      expect.objectContaining({ action: 'claim', appearance: 'interaction-only', sitekey: 'site-key' }),
    )
    expect(api.remove).toHaveBeenCalledWith('widget-1')
  })

  it('renders a fresh widget for every request', async () => {
    const api = fakeApi((options) => {
      options.callback('tok')
    })
    const load = async (): Promise<TurnstileApi> => await Promise.resolve(api)
    await requestClaimToken('site-key', container(), load)
    await requestClaimToken('site-key', container(), load)
    expect(api.render).toHaveBeenCalledTimes(2)
  })

  it.each(['error-callback', 'expired-callback', 'timeout-callback', 'unsupported-callback'] as const)(
    'fails on %s',
    async (name) => {
      const api = fakeApi((options) => {
        options[name]()
      })
      await expect(
        requestClaimToken('site-key', container(), async () => await Promise.resolve(api)),
      ).resolves.toStrictEqual({ ok: false })
      expect(api.remove).toHaveBeenCalledWith('widget-1')
    },
  )

  it('fails when the script cannot load', async () => {
    await expect(
      requestClaimToken('site-key', container(), async () => await Promise.reject(new Error('blocked'))),
    ).resolves.toStrictEqual({ ok: false })
  })

  it('fails without a place to render', async () => {
    await expect(requestClaimToken('site-key', null)).resolves.toStrictEqual({ ok: false })
  })

  it('asks for no token and loads nothing when there is no site key', async () => {
    const load = vi.fn<() => Promise<TurnstileApi>>()
    await expect(requestClaimToken('', container(), load)).resolves.toStrictEqual({ ok: true, token: null })
    expect(load).not.toHaveBeenCalled()
  })
})
