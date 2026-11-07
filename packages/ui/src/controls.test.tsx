// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui/test'
import { afterEach, describe, expect, it } from 'vitest'

import { LanguageSwitcher, ThemeToggle } from './controls.tsx'
import { IconButton } from './IconButton.tsx'

const OPTIONS = [
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
]

const disposers: (() => void)[] = []
const open = (view: Parameters<typeof mount>[0]): HTMLElement => {
  const mounted = mount(view)
  disposers.push(mounted.dispose)
  return mounted.host
}

describe('appearance controls', () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
  })

  it('exposes an icon button by its accessible name', () => {
    const host = open(
      <IconButton label="Close menu" onClick={() => {}}>
        <span aria-hidden="true">X</span>
      </IconButton>,
    )
    const button = host.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Close menu')
    expect(button?.getAttribute('type')).toBe('button')
  })

  it('names the theme control with its current localized mode', () => {
    const host = open(
      <ThemeToggle
        labels={{ control: 'Theme', dark: 'Dark', light: 'Light', system: 'System' }}
        mode="system"
        onChange={() => {}}
      />,
    )
    const button = host.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Theme: System')
    expect(button?.className).toBe('fuda-icon-button')
    expect(host.querySelector('svg')?.dataset.ico).toBe('system')
  })

  it('advances the theme mode when tapped', async () => {
    const changes: string[] = []
    const host = open(
      <ThemeToggle
        labels={{ control: 'Theme', dark: 'Dark', light: 'Light', system: 'System' }}
        mode="light"
        onChange={(mode) => {
          changes.push(mode)
        }}
      />,
    )
    expect(host.querySelector('svg')?.dataset.ico).toBe('light')
    await settle(() => {
      host.querySelector('button')?.click()
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]).not.toBe('light')
  })

  it('renders the language choice as a labelled globe menu', () => {
    const host = open(
      <LanguageSwitcher current="en" label="Language" onChange={() => {}} options={OPTIONS} />,
    )
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

  it('closes the language menu and forwards the selected value', async () => {
    const changes: string[] = []
    const host = open(
      <LanguageSwitcher
        current="en"
        label="Language"
        onChange={(value) => {
          changes.push(value)
        }}
        options={OPTIONS}
      />,
    )
    const menu = host.querySelector('details')!
    menu.open = true
    await settle(() => {
      host.querySelectorAll('button')[1]?.click()
    })
    expect(changes).toStrictEqual(['ja'])
    expect(menu.open).toBe(false)
  })

  it('closes an open language menu on Escape or a click outside it', async () => {
    const host = open(
      <LanguageSwitcher current="en" label="Language" onChange={() => {}} options={OPTIONS} />,
    )
    const menu = host.querySelector('details')!

    menu.open = true
    host.querySelectorAll('button')[1].focus()
    await settle(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(menu.querySelector('summary'))

    menu.open = true
    await settle(() => {
      menu.querySelector('summary')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(menu.open).toBe(true)

    await settle(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(menu.open).toBe(false)
  })

  it('renders options with an href as links that still report the choice', async () => {
    const changes: string[] = []
    const host = open(
      <LanguageSwitcher
        current="en"
        label="Language"
        onChange={(value) => {
          changes.push(value)
        }}
        options={[
          { href: '/', label: 'English', value: 'en' },
          { href: '/ja', label: '日本語', value: 'ja' },
        ]}
      />,
    )
    const links = [...host.querySelectorAll('a')]
    expect(links.map((link) => [link.getAttribute('href'), link.hreflang])).toStrictEqual([
      ['/', 'en'],
      ['/ja', 'ja'],
    ])
    expect(links[0]?.getAttribute('aria-current')).toBe('true')
    expect(host.querySelector('.fuda-language-menu-panel button')).toBeNull()

    links[1]?.addEventListener('click', (event) => {
      event.preventDefault()
    })
    await settle(() => {
      links[1]?.click()
    })
    expect(changes).toStrictEqual(['ja'])
  })
})
