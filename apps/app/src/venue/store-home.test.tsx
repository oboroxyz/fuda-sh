// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import type { PublicVenue } from '@fuda/sdk'
import { render } from 'hono/jsx/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { fetchVenue } from '../api.ts'
import { StoreHome } from './StoreHome.tsx'
import { VenueScreen } from './VenueScreen.tsx'

const membership: PublicVenue['cards'][number] = {
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  description: 'Private description',
  id: 'm',
  slug: 'membership',
  title: 'Membership',
  validFrom: null,
  validUntil: null,
  validityDays: null,
}
const venue: PublicVenue = {
  brandColor: '#6F4320',
  cards: [membership, { ...membership, id: 't', slug: 'tasting', title: 'Tasting' }],
  defaultCardSlug: 'membership',
  handle: 'coffee',
  logoUrl: null,
  name: 'Coffee',
  tagline: 'Everyday coffee',
}

describe('store entry and display', () => {
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('shows a branded default-card QR and switches manually without issuing or navigating', async () => {
    const host = document.createElement('div')
    render(<StoreHome venue={venue} origin="https://app.fuda.sh" />, host)
    expect(host.querySelector('main')?.style.backgroundColor).toBe('#6F4320')
    expect({
      description: host.textContent?.includes('Private description'),
      tagline: host.textContent?.includes('Everyday coffee'),
    }).toStrictEqual({ description: false, tagline: true })
    expect(host.querySelector('[data-claim-link]')?.getAttribute('href')).toBe(
      'https://app.fuda.sh/@coffee/membership',
    )
    const firstQr = host.querySelector('[role="img"]')?.innerHTML
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-claim-link]')?.getAttribute('href')).toBe(
        'https://app.fuda.sh/@coffee/tasting',
      )
    })
    expect(host.querySelector('[role="img"]')?.innerHTML).not.toBe(firstQr)
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Tasting')
    render(<></>, host)
  })

  it('does not display a claim QR for a closed default and allows explicit alternative selection', async () => {
    const host = document.createElement('div')
    render(
      <StoreHome
        venue={{ ...venue, cards: [{ ...membership, claimable: false }, venue.cards[1]] }}
        origin="https://app.fuda.sh"
        locale="ja"
      />,
      host,
    )
    expect(host.querySelector('[role="img"]')).toBeNull()
    expect(host.textContent).toContain('現在配布していません')
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click()
    await vi.waitFor(() => {
      expect(host.querySelector('[role="img"]')).not.toBeNull()
    })
    render(<></>, host)
  })

  it('replaces the bare URL with the default claim URL, retaining query parameters', async () => {
    const host = document.createElement('div')
    const replace = vi.fn<(href: string) => void>()
    const fetch = vi.fn<typeof fetchVenue>(async () => await Promise.resolve({ body: venue, ok: true }))
    render(
      <VenueScreen handle="coffee" mode="entry" search="?lang=ja" fetchVenue={fetch} replace={replace} />,
      host,
    )
    await vi.waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/@coffee/membership?lang=ja')
    })
    expect(fetch).toHaveBeenCalledOnce()
    render(<></>, host)
  })

  it('explains a missing default and lets the store explicitly choose its single remaining Card', async () => {
    const host = document.createElement('div')
    render(
      <StoreHome
        venue={{ ...venue, cards: [membership], defaultCardSlug: 'missing' }}
        origin="https://app.fuda.sh"
      />,
      host,
    )
    expect(host.textContent).toContain('The featured card is not available')
    expect(host.querySelector('[role="img"]')).toBeNull()
    expect({
      group: host.querySelector('[role="group"]')?.getAttribute('aria-label'),
      panel: host.querySelector('[role="tabpanel"]'),
    }).toStrictEqual({ group: 'Choose a card', panel: null })
    host.querySelector<HTMLButtonElement>('[role="group"] button')!.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-claim-link]')?.getAttribute('href')).toBe(
        'https://app.fuda.sh/@coffee/membership',
      )
    })
    render(<></>, host)
  })

  it('supports roving focus and arrow, Home and End navigation in the Card tabs', async () => {
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    render(<StoreHome venue={venue} origin="https://app.fuda.sh" />, host)
    const [first, second] = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    await vi.waitFor(() => {
      expect({
        focus: document.activeElement,
        selected: second.getAttribute('aria-selected'),
        tabIndex: second.tabIndex,
      }).toStrictEqual({ focus: second, selected: 'true', tabIndex: 0 })
    })
    second.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }))
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(first)
    })
    first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }))
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(second)
    })
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(second.id)
    render(<></>, host)
  })

  it('keeps the explicit all-cards chooser accessible despite a configured default', async () => {
    const host = document.createElement('div')
    const replace = vi.fn<(href: string) => void>()
    render(
      <VenueScreen
        handle="coffee"
        mode="entry"
        search="?cards=all"
        fetchVenue={async () => await Promise.resolve({ body: venue, ok: true })}
        replace={replace}
      />,
      host,
    )
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Pick a card')
    })
    expect(replace).not.toHaveBeenCalled()
    render(<></>, host)
  })

  it('keeps an iPad on the display page without redirecting it', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPad' })
    const host = document.createElement('div')
    const replace = vi.fn<(href: string) => void>()
    render(
      <VenueScreen
        handle="coffee"
        mode="home"
        search=""
        fetchVenue={async () => await Promise.resolve({ body: venue, ok: true })}
        replace={replace}
      />,
      host,
    )
    await vi.waitFor(() => {
      expect(host.querySelector('[data-claim-link]')).not.toBeNull()
    })
    expect(replace).not.toHaveBeenCalled()
    render(<></>, host)
  })
})
