// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type { Locale } from '@fuda/i18n'
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, describe, expect, it } from 'vitest'

import type { PrfResult } from '../passkey.ts'
import * as stealth from '../private-member.ts'
import { PrivateScreen } from './PrivateScreen.tsx'
import { SignedGate } from './SignedGate.tsx'
import { Verdict } from './Verdict.tsx'

const root = document.createElement('div')
type PrivateIo = NonNullable<Parameters<typeof PrivateScreen>[0]['io']>

const Harness = ({ children }: { children: (locale: Locale) => JSX.Element }): JSX.Element => {
  const [locale, setLocale] = useState<Locale>('en')
  return (
    <>
      {children(locale)}
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

const privateIo = (result: Promise<PrfResult>): PrivateIo => ({
  fetchRows: async () => await Promise.resolve([]),
  passkeys: async () =>
    await Promise.resolve({ createPasskey: async () => await result, loadPasskey: async () => await result }),
  stealth: async () => await Promise.resolve(stealth),
})

describe('entry locale changes', () => {
  afterEach(() => {
    render(<div />, root)
    root.replaceChildren()
  })

  it('keeps a pending private ceremony and translates its result using the current language', async () => {
    const pending = Promise.withResolvers<PrfResult>()
    const io = privateIo(pending.promise)
    render(<Harness>{(locale): JSX.Element => <PrivateScreen io={io} locale={locale} />}</Harness>, root)
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
    render(<Harness>{(locale): JSX.Element => <PrivateScreen io={io} locale={locale} />}</Harness>, root)
    await setTimeout(0)
    click('Use existing passkey')
    await setTimeout(0)
    const metaAddress = root.querySelector('.font-mono')?.textContent
    expect(metaAddress).toBe(stealth.keysFromPrf(output).metaAddress)
    click('Language')
    await setTimeout(0)
    expect(root.textContent).toContain('自分の権利を探す')
    expect(root.querySelector('.font-mono')?.textContent).toBe(metaAddress)
    expect(root.textContent).not.toContain('既存のパスキーを使う')
  })

  it('retains scanner input and selected right while translating wallet actions', async () => {
    render(<Harness>{(locale): JSX.Element => <SignedGate provider={null} locale={locale} />}</Harness>, root)
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
      <Verdict
        locale="ja"
        state={{ detail: 'REVOKED', title: 'REJECT', tone: 'red' }}
        onDone={() => {
          dismissed = true
        }}
      />,
      root,
    )
    expect(root.textContent).toContain('入場できません')
    expect(root.textContent).toContain('この権利は取り消されています。')
    expect(root.textContent).toContain('REVOKED')
    root.querySelector('button')?.click()
    await setTimeout(0)
    expect(dismissed).toBe(true)
  })
})
