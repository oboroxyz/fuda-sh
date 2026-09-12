// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { PublishedCard } from './PublishedCard.tsx'
import type { PublishedCardProps } from './PublishedCard.tsx'
import { membershipCard, passesResponse, ticketCard } from './test/management-fixtures.ts'

let root: HTMLDivElement

const props = (): PublishedCardProps => ({
  canAddCard: true,
  cards: [membershipCard, ticketCard],
  copy: DASH_COPY.en.published,
  issuer: {
    brandColor: '#0073EB',
    createdAt: 1,
    handle: 'coffee',
    id: 'issuer',
    logoUrl: null,
    name: 'Coffee',
    operatorAddress: `0x${'ab'.repeat(20)}`,
    tagline: '',
  },
  loadPasses: vi.fn<PublishedCardProps['loadPasses']>().mockResolvedValue({ body: passesResponse, ok: true }),
  managementCopy: DASH_COPY.en.management,
  onAddCard: vi.fn<PublishedCardProps['onAddCard']>(),
  onDefaultCard: vi.fn<PublishedCardProps['onDefaultCard']>().mockResolvedValue(true),
  onNavigate: vi.fn<PublishedCardProps['onNavigate']>(),
  onSettings: vi.fn<PublishedCardProps['onSettings']>(),
  onVenue: vi.fn<PublishedCardProps['onVenue']>(),
  publicUrl: 'https://fuda.sh/@coffee',
})
const rows = () => [...root.querySelectorAll('tbody tr')]

describe('Card list', () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(null, root)
    root.remove()
    vi.restoreAllMocks()
  })

  it('renders card data and real aggregate counts without card previews', async () => {
    const p = props()
    render(<PublishedCard {...p} />, root)
    await vi.waitFor(() => {
      expect(rows()).toHaveLength(2)
    })
    await vi.waitFor(() => {
      expect(rows()[0]?.textContent).toContain('40')
    })
    expect(rows()[0]?.textContent).toContain('Coffee membership')
    expect(rows()[0]?.textContent).toContain('30')
    expect(rows()[0]?.textContent).toContain('Does not expire')
    expect(rows()[1]?.textContent).toContain('Valid 30 days after claiming')
  })

  it('offers creation, edit and public links without card previews', () => {
    render(<PublishedCard {...props()} />, root)
    expect(root.querySelector('.dash-card-preview')).toBeNull()
    expect(root.querySelector('a[href="/cards/new"]')?.textContent).toBe('+ Add card')
    expect(root.querySelector('a[href="/cards/membership/edit"]')?.textContent).toBe('Edit')
    expect(root.querySelector('a[href="https://fuda.sh/@coffee/membership"]')?.getAttribute('target')).toBe(
      '_blank',
    )
  })

  it('links to the store display while keeping the existing home Card on its explicit claim route', () => {
    const p = props()
    render(<PublishedCard {...p} cards={[{ ...membershipCard, id: 'home-card', slug: 'home' }]} />, root)

    expect(root.querySelector('a[href="https://fuda.sh/@coffee/home"]')?.textContent).toBe(
      'Open store display',
    )
    expect(root.querySelector('a[href="https://fuda.sh/@coffee/card/home"]')).not.toBeNull()
  })

  it('marks the default Card and clears it with pending feedback', async () => {
    const pending = Promise.withResolvers<boolean>()
    const p = props()
    const onDefaultCard = vi.fn<PublishedCardProps['onDefaultCard']>().mockReturnValue(pending.promise)
    p.issuer = { ...p.issuer, defaultCardSlug: membershipCard.slug }
    p.onDefaultCard = onDefaultCard
    render(<PublishedCard {...p} />, root)

    expect(rows()[0]?.textContent).toContain('Default')
    const clear = [...rows()[0].querySelectorAll('button')].find(
      (node) => node.textContent === 'Clear default',
    )!
    clear.click()
    await vi.waitFor(() => {
      expect(clear.disabled).toBe(true)
      expect(clear.textContent).toBe('Saving…')
    })
    expect(onDefaultCard).toHaveBeenCalledExactlyOnceWith(null)
    pending.resolve(true)
    await vi.waitFor(() => {
      expect(root.querySelector('[role=status]')?.textContent).toContain('Default card updated')
    })
  })

  it('serializes the default action state for assistive technology', () => {
    const p = props()
    p.issuer = { ...p.issuer, defaultCardSlug: membershipCard.slug }
    render(<PublishedCard {...p} />, root)

    const pressed = [...root.querySelectorAll('button[aria-pressed]')]
    expect(pressed).toHaveLength(2)
    expect(pressed[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(pressed[1]?.getAttribute('aria-pressed')).toBe('false')
  })

  it('starts only one default save when the action is clicked twice immediately', async () => {
    const pending = Promise.withResolvers<boolean>()
    const p = props()
    const onDefaultCard = vi.fn<PublishedCardProps['onDefaultCard']>().mockReturnValue(pending.promise)
    p.onDefaultCard = onDefaultCard
    render(<PublishedCard {...p} />, root)
    const setDefault = [...rows()[1].querySelectorAll('button')].find(
      (node) => node.textContent === 'Set as default',
    )!

    setDefault.click()
    setDefault.click()

    expect(onDefaultCard).toHaveBeenCalledExactlyOnceWith(ticketCard.slug)
    pending.resolve(true)
    await vi.waitFor(() => {
      expect(root.querySelector('[role=status]')?.textContent).toContain('Default card updated')
    })
  })

  it('sets a default Card and reports a failed save without changing the marker', async () => {
    const p = props()
    const onDefaultCard = vi.fn<PublishedCardProps['onDefaultCard']>().mockResolvedValue(false)
    p.issuer = { ...p.issuer, defaultCardSlug: null }
    p.onDefaultCard = onDefaultCard
    render(<PublishedCard {...p} />, root)

    const setDefault = [...rows()[1].querySelectorAll('button')].find(
      (node) => node.textContent === 'Set as default',
    )!
    setDefault.click()

    await vi.waitFor(() => {
      expect(onDefaultCard).toHaveBeenCalledExactlyOnceWith(ticketCard.slug)
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Could not update the default card')
    })
    expect(root.textContent).not.toContain('Default card updated')
  })

  it('filters by type and name, and offers a reset after no matches', async () => {
    render(<PublishedCard {...props()} />, root)
    await vi.waitFor(() => {
      expect(rows()[0]?.textContent).toContain('40')
    })
    const type = root.querySelector<HTMLSelectElement>('select')!
    type.value = 'ticket'
    type.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(rows()[0]?.textContent).toContain('Summer event')
    const search = root.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = 'missing'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain('No cards match')
    })
    const clear = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Clear filters')!
    clear.click()
    await vi.waitFor(() => {
      expect(rows()).toHaveLength(2)
    })
  })

  it('copies the selected public link and reports clipboard failure', async () => {
    const clipboard = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('denied'))
    render(<PublishedCard {...props()} />, root)
    await vi.waitFor(() => {
      expect(rows()).toHaveLength(2)
    })
    rows()[1].querySelector('button')!.click()
    await vi.waitFor(() => {
      expect(rows()[1]?.textContent).toContain('Copied')
    })
    expect(clipboard).toHaveBeenCalledWith('https://fuda.sh/@coffee/summer')
    rows()[0].querySelector('button')!.click()
    await vi.waitFor(() => {
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Could not copy')
    })
  })

  it('shows statistics errors rather than presenting missing counts as zero', async () => {
    const p = props()
    render(
      <PublishedCard
        {...p}
        loadPasses={async () =>
          await Promise.resolve({ error: 'offline', network: true, ok: false, status: 0 })
        }
      />,
      root,
    )
    await vi.waitFor(() => {
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Could not load')
    })
    expect(rows()[0]?.textContent).toContain('—')
    expect(root.querySelector('a[href="/cards/membership/edit"]')).not.toBeNull()
  })
})
