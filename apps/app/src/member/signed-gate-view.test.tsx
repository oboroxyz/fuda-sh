// @vitest-environment happy-dom
import type { Hex } from '@fuda/sdk'
import { mount, settle } from '@fuda/ui/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as baseAccount from '../base-account.ts'
import type { Eip1193Provider } from '../wallet.ts'
import { SignedGate } from './SignedGate.tsx'
import type { SignedGateScreenIo } from './SignedGate.tsx'

const uid = `0x${'ab'.repeat(32)}` as const
const secondUid = `0x${'cd'.repeat(32)}` as const
const fail = { error: 'unused', network: false, ok: false, status: 400 } as const
const preview = {
  body: {
    decision: 'ADMIT',
    entitlement: {
      holder: `0x${'00'.repeat(20)}`,
      issuer: `0x${'22'.repeat(20)}`,
      level: 1,
      schemaVersion: 1,
      tier: 0,
      usageModel: 1,
      validFrom: 0,
      validUntil: 0,
    },
    reason: 'OK',
  },
  ok: true,
} as const
const io = (): SignedGateScreenIo => ({
  assert: async () => await Promise.reject(new Error('unused')),
  challenge: vi.fn<SignedGateScreenIo['challenge']>().mockResolvedValue(fail),
  preview: vi.fn<SignedGateScreenIo['preview']>().mockResolvedValue(preview),
  signForPass: async () => await Promise.reject(new Error('unused')),
  verify: vi.fn<SignedGateScreenIo['verify']>().mockResolvedValue(fail),
})
const disposers: (() => void)[] = []

const scan = async (host: HTMLElement, text: string): Promise<void> => {
  const input = host.querySelector('input')
  if (input === null) {
    throw new Error('Scanner is missing')
  }
  input.value = text
  await settle(() => {
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('signed entry component lifetime', () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
    history.replaceState(null, '', '/')
    vi.restoreAllMocks()
  })

  it('preserves the pending ceremony through a rerender and carries the venue', async () => {
    history.replaceState(null, '', `/signed?uid=${uid}&venue=fictional-shop`)
    const deps = io()
    const pending = Promise.withResolvers<Awaited<ReturnType<SignedGateScreenIo['challenge']>>>()
    vi.mocked(deps.challenge).mockReturnValue(pending.promise)
    const view = mount(<SignedGate io={deps} provider={null} locale="en" />)
    disposers.push(view.dispose)
    await vi.waitFor(() => {
      expect(view.host.querySelector('input')).toBeNull()
    })
    await settle(() => {
      view.host.querySelector('button')?.click()
      view.host.querySelector('button')?.click()
    })
    view.update(<SignedGate io={deps} provider={null} locale="ja" />)
    expect(deps.challenge).toHaveBeenCalledExactlyOnceWith(uid, 'fictional-shop')
    pending.resolve(fail)
    await vi.waitFor(() => {
      expect(view.host.textContent).toContain('入場できません')
    })
    expect(deps.preview).toHaveBeenCalledOnce()
  })

  it('aborts a pending entry when unmounted', async () => {
    history.replaceState(null, '', `/signed?uid=${uid}`)
    const deps = io()
    const pending = Promise.withResolvers<Awaited<ReturnType<SignedGateScreenIo['challenge']>>>()
    vi.mocked(deps.challenge).mockReturnValue(pending.promise)
    const view = mount(<SignedGate io={deps} provider={null} locale="en" />)
    await vi.waitFor(() => {
      expect(view.host.querySelector('input')).toBeNull()
    })
    await settle(() => view.host.querySelector('button')?.click())
    view.dispose()
    pending.resolve({ body: { challenge: 'message', nonce: uid }, ok: true })
    await settle()
    expect(deps.verify).not.toHaveBeenCalled()
    expect(view.host.textContent).toBe('')
  })

  it('cancels previews per target and remounts the Scanner after rejecting a non-pass QR', async () => {
    const deps = io()
    const targets: { signal: AbortSignal | undefined; uid: Hex }[] = []
    vi.mocked(deps.preview).mockImplementation(async (target, signal) => {
      targets.push({ signal, uid: target })
      return await Promise.resolve(fail)
    })
    const view = mount(<SignedGate io={deps} provider={null} locale="en" />)
    disposers.push(view.dispose)
    await scan(view.host, uid)
    await scan(view.host, secondUid)
    expect(targets.map((target) => [target.uid, target.signal?.aborted])).toStrictEqual([
      [uid, true],
      [secondUid, false],
    ])
    const scanner = view.host.querySelector('form')
    await scan(view.host, 'https://example.invalid/not-a-pass')
    expect([view.host.textContent?.includes('REJECT'), view.host.querySelector('form')]).toStrictEqual([
      true,
      null,
    ])
    await settle(() => view.host.querySelector('button')?.click())
    const remounted = view.host.querySelector('form')
    expect(remounted !== null && remounted !== scanner).toBe(true)
    view.dispose()
    expect(targets[1]?.signal?.aborted).toBe(true)
  })

  it('turns a lazily opened wallet rail failure into a REJECT verdict', async () => {
    history.replaceState(null, '', `/signed?uid=${uid}`)
    const load = vi
      .spyOn(baseAccount, 'baseAccountProvider')
      .mockRejectedValue(new Error('rail chunk unavailable'))
    const deps = io()
    vi.mocked(deps.preview).mockResolvedValue(fail)
    const view = mount(<SignedGate io={deps} provider={null} locale="en" />)
    disposers.push(view.dispose)
    await vi.waitFor(() => {
      expect(view.host.querySelector('button.btn-primary:not(.join-item)')).not.toBeNull()
    })
    await settle(() => {
      view.host.querySelector<HTMLButtonElement>('button.btn-primary:not(.join-item)')?.click()
    })
    await vi.waitFor(() => {
      expect(view.host.textContent).toContain('REJECT')
    })
    expect(view.host.textContent).toContain('rail chunk unavailable')
    expect(load).toHaveBeenCalledOnce()
    expect(deps.challenge).not.toHaveBeenCalled()
  })

  it('offers no wallet for a newly scanned pass until its own preview answers', async () => {
    const request = vi.fn<Eip1193Provider['request']>().mockRejectedValue(new Error('wrong rail opened'))
    const second = Promise.withResolvers<Awaited<ReturnType<SignedGateScreenIo['preview']>>>()
    const screen = io()
    vi.mocked(screen.preview).mockImplementation(async (target) =>
      target === uid ? fail : await second.promise,
    )
    window.history.replaceState(null, '', `/signed?uid=${uid}`)
    const view = mount(<SignedGate io={screen} provider={{ request }} />)
    disposers.push(view.dispose)
    await vi.waitFor(() => {
      expect(view.host.querySelector('button.btn-ghost')).not.toBeNull()
    })
    const input = view.host.querySelector('input')
    if (input !== null) {
      input.value = secondUid
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    view.host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    await Promise.resolve()
    view.host.querySelector<HTMLButtonElement>('button.btn-ghost')?.click()
    await settle()
    expect(request).not.toHaveBeenCalled()
    second.resolve(fail)
    await settle()
    window.history.replaceState(null, '', '/signed')
  })
})
