// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { LanguageSwitcher, ThemeToggle } from './controls.tsx'
import { IconButton } from './IconButton.tsx'
import { mount } from './test-render.tsx'

const OPTIONS = [
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
]

describe('appearance controls', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('exposes an icon button by its accessible name', () => {
    const host = mount(() => (
      <IconButton label="Close menu" onClick={() => {}}>
        <span aria-hidden="true">X</span>
      </IconButton>
    ))
    const button = host.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Close menu')
    expect(button?.getAttribute('type')).toBe('button')
  })

  it('names the theme control with its current localized mode', () => {
    const host = mount(() => (
      <ThemeToggle
        labels={{ control: 'Theme', dark: 'Dark', light: 'Light', system: 'System' }}
        mode="system"
        onChange={() => {}}
      />
    ))
    const button = host.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Theme: System')
    expect(button?.className).toBe('fuda-icon-button')
    expect(host.querySelector('svg')?.dataset.ico).toBe('system')
  })

  it('advances the theme mode when tapped', () => {
    const changes: string[] = []
    const host = mount(() => (
      <ThemeToggle
        labels={{ control: 'Theme', dark: 'Dark', light: 'Light', system: 'System' }}
        mode="light"
        onChange={(mode) => {
          changes.push(mode)
        }}
      />
    ))
    expect(host.querySelector('svg')?.dataset.ico).toBe('light')
    host.querySelector('button')?.click()
    expect(changes).toHaveLength(1)
    expect(changes[0]).not.toBe('light')
  })

  it('renders the language choice as a labelled globe menu', () => {
    const host = mount(() => (
      <LanguageSwitcher current="en" label="Language" onChange={() => {}} options={OPTIONS} />
    ))
    expect(host.querySelector('details')?.className).toBe('fuda-language-menu')
    const summary = host.querySelector('summary')
    expect(summary?.getAttribute('aria-label')).toBe('Language')
    expect(summary?.className).toBe('fuda-icon-button')
    expect(host.querySelector('svg')?.dataset.ico).toBe('language')
    expect([...host.querySelectorAll('button')].map((b) => b.getAttribute('aria-current'))).toStrictEqual([
      'true',
      null,
    ])
  })

  it('closes the language menu and forwards the selected value', () => {
    const changes: string[] = []
    const host = mount(() => (
      <LanguageSwitcher
        current="en"
        label="Language"
        onChange={(value) => {
          changes.push(value)
        }}
        options={OPTIONS}
      />
    ))
    const menu = host.querySelector('details')!
    menu.open = true
    host.querySelectorAll('button')[1]?.click()
    expect(changes).toStrictEqual(['ja'])
    expect(menu.open).toBe(false)
  })
})
