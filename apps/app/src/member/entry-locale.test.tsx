// @vitest-environment happy-dom
import { setTimeout } from 'node:timers/promises'

import type { Locale } from '@fuda/i18n'
import { createSignal } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'
import { render as solidRender } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'

import { SignedGate } from './SignedGate.tsx'
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

describe('entry locale changes', () => {
  afterEach(() => {
    unmountAll()
    root.replaceChildren()
  })

  it('retains scanner input and selected right while translating wallet actions', async () => {
    render(
      () => <Harness>{(locale): JSX.Element => <SignedGate provider={null} locale={locale()} />}</Harness>,
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
})
