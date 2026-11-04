// @vitest-environment happy-dom
import { setTimeout } from 'node:timers/promises'

import type { Locale } from '@fuda/i18n'
import { createSignal } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'
import { render as solidRender } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'

import { SignedGate } from './SignedGate.tsx'
import type { SignedGateScreenIo } from './SignedGate.tsx'
import { Verdict } from './Verdict.tsx'

const disposers: (() => void)[] = []
// Solid delegates events to the document, so a host must be attached to
// receive clicks.
const render = (view: () => JSX.Element, host: HTMLElement): void => {
  if (!host.isConnected) {
    document.body.append(host)
  }
  disposers.push(solidRender(view, host))
}
const unmountAll = (): void => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
}

const root = document.createElement('div')

// The screen is built once and reads the language as it changes, so a switch
// translates it in place instead of rebuilding it.
const Harness = (props: { children: (locale: Accessor<Locale>) => JSX.Element }): JSX.Element => {
  const [locale, setLocale] = createSignal<Locale>('en')
  return (
    <>
      {props.children(locale)}
      <button
        type="button"
        onClick={() => {
          setLocale(locale() === 'en' ? 'ja' : 'en')
        }}
      >
        Language
      </button>
    </>
  )
}

const click = (label: string): void => {
  const button = [...root.querySelectorAll('button')].find((node) => node.textContent?.includes(label))
  if (button === undefined) {
    throw new Error(`missing ${label}`)
  }
  button.click()
}

const privateIo = (result: Promise<PrfResult>): PrivateIo => ({
  fetchRows: async () => await Promise.resolve([]),
  passkeys: async () =>
    await Promise.resolve({ createPasskey: async () => await result, loadPasskey: async () => await result }),
  stealth: async () => await Promise.resolve(stealth),
})

const gateIo = (kind: 'passkey' | 'wallet'): SignedGateScreenIo => ({
  assert: async () => await Promise.reject(new Error('no prompt in this test')),
  challenge: async () => await Promise.resolve({ error: 'unused', network: false, ok: false, status: 400 }),
  preview: async () =>
    await Promise.resolve({
      body: {
        decision: 'ADMIT',
        entitlement: {
          holder: kind === 'passkey' ? `0x${'00'.repeat(20)}` : `0x${'11'.repeat(20)}`,
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
    }),
  signForPass: async () => await Promise.reject(new Error('no prompt in this test')),
  verify: async () => await Promise.resolve({ error: 'unused', network: false, ok: false, status: 400 }),
})

describe('entry locale changes', () => {
  afterEach(() => {
    unmountAll()
    root.replaceChildren()
  })

  it('keeps a pending private ceremony and translates its result using the current language', async () => {
    const pending = Promise.withResolvers<PrfResult>()
    const io = privateIo(pending.promise)
    render(
      () => <Harness>{(locale): JSX.Element => <PrivateScreen io={io} locale={locale()} />}</Harness>,
      root,
    )
    await setTimeout(0)
    click('Use existing passkey')
    await setTimeout(0)
    click('Language')
    await setTimeout(0)
    expect(root.textContent).toContain('既存のパスキーを使う')
    expect(root.querySelector<HTMLButtonElement>('.btn-primary')?.disabled).toBe(true)
    pending.resolve({ detail: 'prompt dismissed', ok: false, reason: 'cancelled' })
    await setTimeout(0)
    expect(root.textContent).toContain('パスキーの操作をキャンセルしました。')
    click('Language')
    await setTimeout(0)
    expect(root.textContent).toContain('The passkey prompt was dismissed.')
    expect(root.textContent).toContain('prompt dismissed')
  })

  it('retains unlocked private keys across a language change', async () => {
    const output = new Uint8Array(32).fill(7)
    const io = privateIo(Promise.resolve({ ok: true, output }))
    render(
      () => <Harness>{(locale): JSX.Element => <PrivateScreen io={io} locale={locale()} />}</Harness>,
      root,
    )
    await setTimeout(0)
    click('Use existing passkey')
    await setTimeout(0)
    const metaAddress = root.querySelector('.font-mono')?.textContent
    expect(metaAddress).toBeTruthy()
    click('Meta-address details')
    await setTimeout(0)
    expect(root.querySelector('dialog')?.textContent).toContain(stealth.keysFromPrf(output).metaAddress)
    click('Language')
    await setTimeout(0)
    expect(root.textContent).toContain('自分の権利を探す')
    expect({
      compact: root.querySelector('.font-mono')?.textContent,
      full: root.querySelector('dialog dd')?.textContent?.includes(stealth.keysFromPrf(output).metaAddress),
    }).toStrictEqual({ compact: metaAddress, full: true })
    expect(root.textContent).not.toContain('既存のパスキーを使う')
  })

  it('offers only the passkey to a pass that answers to one, from the address', async () => {
    globalThis.history.replaceState(null, '', `/signed?uid=0x${'ab'.repeat(32)}`)
    render(
      () => (
        <Harness>{(locale): JSX.Element => <SignedGate io={gateIo('passkey')} locale={locale()} />}</Harness>
      ),
      root,
    )
    await setTimeout(0)
    globalThis.history.replaceState(null, '', '/')
    expect(root.textContent).toContain('Enter with your passkey')
    expect(root.textContent).not.toContain('Passkey wallet')
    expect(root.querySelector('input')).toBeNull()
  })

  it('retains scanner input and selected right while translating wallet actions', async () => {
    render(
      () => (
        <Harness>
          {(locale): JSX.Element => <SignedGate io={gateIo('wallet')} provider={null} locale={locale()} />}
        </Harness>
      ),
      root,
    )
    await setTimeout(0)
    const input = root.querySelector('input')
    if (input === null) {
      throw new Error('missing scanner input')
    }
    const uid = `0x${'ab'.repeat(32)}`
    input.value = uid
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await setTimeout(0)
    root.querySelector('form')?.dispatchEvent(
      new CustomEvent('submit', {
        bubbles: true,
        cancelable: true,
        detail: {},
      }),
    )
    await setTimeout(0)
    expect(root.textContent).toContain('Passkey wallet: sign for')
    const video = root.querySelector('video')
    click('Language')
    await setTimeout(0)
    expect(root.textContent).toContain('パスキーウォレットで署名')
    expect(root.textContent).toContain('確認')
    expect(root.querySelector('input')?.value).toBe(uid)
    expect(root.querySelector('video')).toBe(video)
  })

  it('translates a verdict without changing its protocol reason or dismissal', async () => {
    let dismissed = false
    render(
      () => (
        <Verdict
          locale="ja"
          state={{ detail: 'REVOKED', title: 'REJECT', tone: 'red' }}
          onDone={() => {
            dismissed = true
          }}
        />
      ),
      root,
    )
    expect(root.textContent).toContain('入場できません')
    expect(root.textContent).toContain('この権利は取り消されています。')
    expect(root.textContent).toContain('REVOKED')
    root.querySelector('button')?.click()
    await setTimeout(0)
    expect(dismissed).toBe(true)
  })

  it('answers a code that is not a pass, then brings the scanner back', async () => {
    render(() => <SignedGate provider={null} />, root)
    const input = root.querySelector('input')
    if (input === null) {
      throw new Error('the paste box is missing')
    }
    input.value = 'https://example.com/menu'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await setTimeout(0)
    expect(root.textContent).toContain('This is not a fuda pass code.')
    root.querySelector('button')?.click()
    await setTimeout(0)
    expect(root.querySelector('form')).not.toBeNull()
    unmountAll()
  })
})
