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
