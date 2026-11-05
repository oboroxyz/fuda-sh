// @vitest-environment happy-dom
import { setTimeout } from 'node:timers/promises'

import type { Locale } from '@fuda/i18n'
import { mount as mountView } from '@fuda/ui/test'
import type { ComponentChild, JSX } from 'preact'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignedGate } from './SignedGate.tsx'
import type { SignedGateScreenIo } from './SignedGate.tsx'
import { Verdict } from './Verdict.tsx'

const disposers: (() => void)[] = []
const render = (View: () => ComponentChild, host: HTMLElement): void => {
  if (!host.isConnected) {
    document.body.append(host)
  }
  disposers.push(mountView(<View />, host).dispose)
}
const unmountAll = (): void => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
}

const root = document.createElement('div')

// The screen is built once and reads the language as it changes, so a switch
// translates it in place instead of rebuilding it.
const Harness = (props: { children: (locale: Locale) => JSX.Element }): JSX.Element => {
  const [locale, setLocale] = useState<Locale>('en')
  return (
    <>
      {props.children(locale)}
      <button
        type="button"
        onClick={() => {
          setLocale(locale === 'en' ? 'ja' : 'en')
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

  it('offers only the passkey to a pass that answers to one, from the address', async () => {
    globalThis.history.replaceState(null, '', `/signed?uid=0x${'ab'.repeat(32)}`)
    render(
      () => (
        <Harness>{(locale): JSX.Element => <SignedGate io={gateIo('passkey')} locale={locale} />}</Harness>
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
          {(locale): JSX.Element => <SignedGate io={gateIo('wallet')} provider={null} locale={locale} />}
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
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Passkey wallet: sign for')
    })
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
    render(() => <SignedGate provider={null} locale="en" />, root)
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

  it('shows the actual venue on the verdict staff read', () => {
    render(
      () => (
        <Verdict
          state={{ detail: '', title: 'ADMIT', tone: 'green', venue: 'coffee' }}
          locale="en"
          onDone={() => {}}
        />
      ),
      root,
    )
    expect(root.textContent).toContain('@coffee')
    expect(root.textContent).toContain('ADMIT')
  })
})
