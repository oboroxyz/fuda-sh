import type { Hex, PublicCard } from '@fuda/sdk'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { describe, expect, it } from 'vitest'

import { CardScreenView, issueDateOf } from './CardScreen.tsx'
import type { IssuedCard } from './CardScreen.tsx'

interface ViewNode {
  props: {
    'aria-label'?: unknown
    children?: unknown
    class?: unknown
    disabled?: unknown
    href?: unknown
    role?: unknown
    style?: unknown
  }
}

const isViewNode = (value: unknown): value is ViewNode => {
  if (typeof value !== 'object' || value === null || !('props' in value)) {
    return false
  }
  const { props } = value
  return typeof props === 'object' && props !== null
}

const viewNodes = (value: unknown): ViewNode[] => {
  if (Array.isArray(value)) {
    return value.flatMap(viewNodes)
  }
  return isViewNode(value) ? [value, ...viewNodes(value.props.children)] : []
}

const isTextChild = (value: unknown): value is bigint | number | string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'

const viewText = (value: unknown): string => {
  if (isTextChild(value)) {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(viewText).join(' ')
  }
  return isViewNode(value) ? viewText(value.props.children) : ''
}

const UID: Hex = `0x${'ab'.repeat(32)}`
const HOLDER: Hex = `0x${'11'.repeat(20)}`

const card: PublicCard = {
  brandColor: '#1D4ED8',
  card: {
    category: 'membership',
    id: 'c1',
    perk: 'Free refill on every visit',
    reward: '10th coffee on the house',
    title: 'Regular',
    validityDays: null,
  },
  handle: 'wassie-coffee',
  name: 'Wassie Coffee',
  tagline: 'Slow coffee, fast wifi',
}

const issued: IssuedCard = {
  holder: HOLDER,
  issuedAt: Date.UTC(2026, 8, 7, 12),
  memberNumber: 'qj2yxphepdrka',
  passUrls: {
    apple: `http://localhost:8787/pass/${UID}/apple.pkpass`,
    google: `http://localhost:8787/pass/${UID}/google`,
    web: `http://localhost:8787/pass/${UID}`,
  },
  qr: `fuda:${UID}`,
  uid: UID,
}

const noop = (): void => {}

const render = (state: Parameters<typeof CardScreenView>[0]['state']): JSX.Element =>
  CardScreenView({ onIssue: noop, onReload: noop, state })

describe(CardScreenView, () => {
  it('shows the venue card, its perks and the free-card button on the landing', () => {
    const view = render({ card, kind: 'landing' })
    const text = viewText(view)

    expect(text).toContain('Wassie Coffee')
    expect(text).toContain('Regular')
    expect(text).toMatch(/Free refill on every visit.*10th coffee on the house/u)
    expect(text).toContain('Get your free membership card')
    expect(text).toContain('No sign-up · No app install')
  })

  it('paints the card in the brand colour', () => {
    const view = render({ card, kind: 'landing' })

    expect(viewNodes(view).some(({ props }) => props.style !== undefined)).toBe(true)
    expect(viewNodes(view).find(({ props }) => props.style !== undefined)?.props.style).toStrictEqual({
      background: '#1D4ED8',
    })
  })

  it('omits empty perks and disables the button while issuing', () => {
    const bare: PublicCard = { ...card, card: { ...card.card, perk: '', reward: '' }, tagline: '' }
    const landing = render({ card: bare, kind: 'landing' })
    const issuing = render({ card, kind: 'issuing' })

    expect(viewNodes(landing).some(({ props }) => props.class === 'flex flex-col gap-1 text-sm')).toBe(false)
    expect(viewNodes(issuing).some(({ props }) => props.disabled === true)).toBe(true)
    expect(viewText(issuing)).toContain('Getting your card…')
  })

  it('renders the ready card with the formatted member number, issue date and QR', () => {
    const view = render({ card, googleHref: null, issued, kind: 'ready' })
    const text = viewText(view)
    const qr = viewNodes(view).find(({ props }) => props.role === 'img')

    expect(text).toContain('Your card is ready')
    expect(text).toContain('MEMBER')
    expect(text).toContain('QJ2Y-XPHE-PDRKA')
    expect(text).toContain('Sep 7, 2026')
    expect(qr?.props['aria-label']).toBe('Your membership card QR code for Wassie Coffee')
  })

  it('links Apple and the browser pass, and hides Google until a save link exists', () => {
    const hidden = render({ card, googleHref: null, issued, kind: 'ready' })
    const shown = render({ card, googleHref: 'https://pay.google.com/gp/v/save', issued, kind: 'ready' })
    const hrefs = (view: unknown): unknown[] => viewNodes(view).map(({ props }) => props.href)

    expect(hrefs(hidden)).toContain(issued.passUrls.apple)
    expect(hrefs(hidden)).toContain(issued.passUrls.web)
    expect(viewText(hidden)).not.toContain('Add to Google Wallet')
    expect(hrefs(shown)).toContain('https://pay.google.com/gp/v/save')
    expect(viewText(shown)).toContain('No name or contact details required')
  })

  it('renders loading, not-found and each failure message', () => {
    const message = (failure: 'chain_error' | 'no_signer' | 'rate_limited' | 'network'): string =>
      viewText(render({ card, failure, kind: 'error' }))

    expect(viewText(render({ kind: 'loading' }))).toContain('Loading card')
    expect(viewText(render({ kind: 'not_found' }))).toContain('No card here')
    expect(message('rate_limited')).toContain('try again later')
    expect(message('no_signer')).toContain('cannot issue cards right now')
    expect(message('chain_error')).toContain('cannot issue cards right now')
  })

  it('formats the issue date in UTC regardless of the device locale', () => {
    expect(issueDateOf(Date.UTC(2026, 0, 31, 23, 59))).toBe('Jan 31, 2026')
  })
})
