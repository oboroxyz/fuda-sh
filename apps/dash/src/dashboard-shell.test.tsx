// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import { pick } from '@fuda/i18n'
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import type { DashRoute, DashSurface } from './router.ts'

let breakpoint: MediaQueryList
let root: HTMLDivElement
let dispose: (() => void) | undefined
let changeRoute: ((route: DashRoute) => void) | undefined
const signOut = vi.fn<() => void>()
const start = (surface: DashSurface = 'operator', hasIssuer = true): void => {
  const Harness = (): JSX.Element | null => {
    const [mounted, setMounted] = useState(true)
    const [route, setRoute] = useState<DashRoute>(surface === 'operator' ? '/published' : '/')
    dispose = () => {
      setMounted(false)
    }
    changeRoute = setRoute
    return mounted ? (
      <DashboardShell
        appearance={<span>Appearance</span>}
        copy={pick(DASH_COPY, 'en')}
        hasIssuer={hasIssuer}
        onNavigate={setRoute}
        onSignOut={signOut}
        route={route}
        surface={surface}
      >
        <p>Page content</p>
      </DashboardShell>
    ) : null
  }
  render(<Harness />, root)
}
const button = (label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
  )
  if (found === undefined) {
    throw new Error(`Missing button: ${label}`)
  }
  return found
}

describe('dashboard navigation', () => {
  beforeEach(() => {
    breakpoint = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList
    vi.spyOn(window, 'matchMedia').mockReturnValue(breakpoint)
    root = document.createElement('div')
    document.body.append(root)
    signOut.mockClear()
    dispose = undefined
    changeRoute = undefined
  })
  afterEach(async () => {
    dispose?.()
    await setTimeout(0)
    root.remove()
    vi.restoreAllMocks()
  })

  it('uses one responsive daisyUI drawer with icons before menu labels', () => {
    start('admin')
    expect(root.querySelector('.drawer.lg\\:drawer-open')).not.toBeNull()
    expect(root.querySelectorAll('nav')).toHaveLength(1)
    const links = [...root.querySelectorAll('nav a')]
    expect(links.map((link) => link.getAttribute('href'))).toStrictEqual(['/', '/rights', '/issue'])
    for (const link of links) {
      expect(link.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    }
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Overview')
  })

  it('requires confirmation and cancels without ending the session', async () => {
    start()
    button('Sign out').click()
    expect(signOut).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(root.querySelector('dialog.modal')?.hasAttribute('open')).toBe(true)
    })
    button('Cancel').click()
    expect(signOut).not.toHaveBeenCalled()
    expect(root.querySelector('dialog.modal')?.hasAttribute('open')).toBe(false)
    button('Sign out').click()
    const confirm = root.querySelector<HTMLButtonElement>('dialog.modal .btn-error')
    if (confirm === null) {
      throw new Error('Missing confirmation')
    }
    confirm.click()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('closes the drawer on Escape and restores focus to its opener', async () => {
    start()
    button('Open menu').click()
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('.drawer-toggle')?.checked).toBe(true)
    })
    root.querySelector('aside')?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('.drawer-toggle')?.checked).toBe(false)
    })
    expect(document.activeElement).toBe(button('Open menu'))
  })

  it('closes the drawer when navigation changes externally', async () => {
    start('admin')
    button('Open menu').click()
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('.drawer-toggle')?.checked).toBe(true)
    })
    changeRoute?.('/rights')
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('.drawer-toggle')?.checked).toBe(false)
    })
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Rights')
  })

  it('keeps modified links native and closes after normal navigation', async () => {
    start('admin')
    button('Open menu').click()
    await setTimeout(0)
    const link = root.querySelector<HTMLAnchorElement>('nav a[href="/rights"]')
    if (link === null) {
      throw new Error('Missing rights link')
    }
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(modified)
    expect(modified.defaultPrevented).toBe(false)
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Overview')
    const primary = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(primary)
    expect(primary.defaultPrevented).toBe(true)
    await vi.waitFor(() => {
      expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Rights')
      expect(root.querySelector<HTMLInputElement>('.drawer-toggle')?.checked).toBe(false)
    })
  })

  it('closes mobile state on desktop entry and removes the breakpoint listener on unmount', async () => {
    const remove = vi.spyOn(breakpoint, 'removeEventListener')
    start()
    button('Open menu').click()
    await setTimeout(0)
    breakpoint.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('.drawer-toggle')?.checked).toBe(false)
    })
    expect(root.querySelector('aside')?.getAttribute('aria-modal')).toBeNull()
    dispose?.()
    await setTimeout(0)
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it.each([true, false])(
    'keeps operator navigation separate from the admin console (issuer: %s)',
    (hasIssuer) => {
      start('operator', hasIssuer)
      expect([...root.querySelectorAll('nav a')].map((link) => link.getAttribute('href'))).toStrictEqual(
        hasIssuer ? ['/published', '/new'] : ['/new'],
      )
    },
  )

  it('traps mobile navigation focus without including closed modal controls', async () => {
    start()
    button('Open menu').click()
    await setTimeout(0)
    button('Sign out').focus()
    button('Sign out').dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' }),
    )
    expect(document.activeElement).toBe(button('Close menu'))
  })
})
