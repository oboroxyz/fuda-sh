// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { ProfileMenu } from './ProfileMenu.tsx'
import type { ProfileChoices } from './ProfileMenu.tsx'

let root: HTMLDivElement

const choices = (): ProfileChoices => ({
  activeId: 'issuer-1',
  issuers: [
    { handle: 'coffee', id: 'issuer-1', logoUrl: null, name: 'Coffee' },
    { handle: 'bar', id: 'issuer-2', logoUrl: null, name: 'Bar' },
  ],
  onAdd: vi.fn<ProfileChoices['onAdd']>(),
  onSwitch: vi.fn<ProfileChoices['onSwitch']>(),
})

const buttonWith = (text: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text))
  if (found === undefined) {
    throw new Error(`missing button ${text}`)
  }
  return found
}

describe(ProfileMenu, () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    root.remove()
  })

  it('marks the active profile, switches to another and opens a new one', async () => {
    const profiles = choices()
    render(
      <ProfileMenu
        copy={DASH_COPY.en}
        onSignOut={null}
        profiles={profiles}
        venue={{ name: 'Coffee', publicUrl: null }}
      />,
      root,
    )
    buttonWith('Coffee').click()
    await setTimeout(0)
    expect(buttonWith('@coffee').getAttribute('aria-current')).toBe('true')
    buttonWith('@bar').click()
    buttonWith(DASH_COPY.en.chrome.addProfile).click()
    expect([vi.mocked(profiles.onSwitch).mock.calls, vi.mocked(profiles.onAdd).mock.calls]).toStrictEqual([
      [['issuer-2']],
      [[]],
    ])
  })
})
