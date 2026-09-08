import { soleCard } from '@fuda/sdk'
import type { Hex, PublicCard, PublicVenue } from '@fuda/sdk'
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
    src?: unknown
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
    claimFrom: null,
    claimUntil: null,
    claimable: true,
    id: 'c1',
    perk: 'Free refill on every visit',
    reward: '10th coffee on the house',
    slug: 'regular',
    title: 'Regular',
    validFrom: null,
    validUntil: null,
    validityDays: null,
  },
  handle: 'wassie-coffee',
  logoUrl: 'https://api.test/assets/wassie-coffee/logo/master?v=abc',
  name: 'Wassie Coffee',
  tagline: 'Slow coffee, fast wifi',
}

const gig = {
  category: 'ticket',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  id: 'c2',
  perk: '',
  reward: '',
  slug: 'gig',
  title: 'Friday Gig',
  validFrom: null,
  validUntil: null,
  validityDays: 1,
} satisfies PublicVenue['cards'][number]

const venue: PublicVenue = {
  brandColor: card.brandColor,
  cards: [card.card, gig],
  handle: card.handle,
  logoUrl: card.logoUrl,
  name: card.name,
  tagline: card.tagline,
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
    const view = render({ appleHref: null, card, googleHref: null, issued, kind: 'ready' })
    const text = viewText(view)
    const qr = viewNodes(view).find(({ props }) => props.role === 'img')

    expect(text).toContain('Your card is ready')
    expect(text).toContain('MEMBER')
    expect(text).toContain('QJ2Y-XPHE-PDRKA')
    expect(text).toContain('Sep 7, 2026')
    expect(qr?.props['aria-label']).toBe('Your membership card QR code for Wassie Coffee')
  })

  it('links the browser pass always, and hides each wallet button until its pass exists', () => {
    const hidden = render({ appleHref: null, card, googleHref: null, issued, kind: 'ready' })
    const hrefs = (view: unknown): unknown[] => viewNodes(view).map(({ props }) => props.href)

    expect(hrefs(hidden)).toContain(issued.passUrls.web)
    expect(hrefs(hidden)).not.toContain(issued.passUrls.apple)
    expect(viewText(hidden)).not.toContain('Add to Apple Wallet')
    expect(viewText(hidden)).not.toContain('Add to Google Wallet')
  })

  it('shows each wallet button once its pass is confirmed', () => {
    const shown = render({
      appleHref: issued.passUrls.apple,
      card,
      googleHref: 'https://pay.google.com/gp/v/save',
      issued,
      kind: 'ready',
    })
    const hrefs = viewNodes(shown).map(({ props }) => props.href)

    expect(hrefs).toContain(issued.passUrls.apple)
    expect(hrefs).toContain('https://pay.google.com/gp/v/save')
    expect(viewText(shown)).toContain('No name or contact details required')
  })

  it('renders loading, not-found and each failure message', () => {
    const message = (failure: 'chain_error' | 'no_signer' | 'rate_limited' | 'network'): string =>
      viewText(render({ card, failure, kind: 'error' }))

    expect(viewText(render({ kind: 'loading' }))).toContain('Loading card')
    expect(viewText(render({ kind: 'not_found', venue: null }))).toContain('No card here')
    expect(message('rate_limited')).toContain('try again later')
    expect(message('no_signer')).toContain('cannot issue cards right now')
    expect(message('chain_error')).toContain('cannot issue cards right now')
  })

  it('formats the issue date in UTC regardless of the device locale', () => {
    expect(issueDateOf(Date.UTC(2026, 0, 31, 23, 59))).toBe('Jan 31, 2026')
  })
})

// A venue publishing several cards cannot open one by itself, so /@<handle>
// names the venue once and lists a row per card.
describe('the card chooser', () => {
  it('names the venue once and links a row per card with its type and perk', () => {
    const view = render({ heldSlugs: [], kind: 'choose', venue })
    const text = viewText(view)
    const hrefs = viewNodes(view)
      .map(({ props }) => props.href)
      .filter((href) => href !== undefined)

    expect(text).toContain('Wassie Coffee')
    expect(text).toContain('Slow coffee, fast wifi')
    expect(text).toMatch(/Regular.*Membership.*Free refill on every visit.*Friday Gig.*Ticket/su)
    expect(hrefs).toStrictEqual(['/@wassie-coffee/regular', '/@wassie-coffee/gig'])
  })

  it('offers a held card back instead of inviting a second claim', () => {
    const held = viewText(render({ heldSlugs: ['regular'], kind: 'choose', venue }))

    expect(held).toContain('You have this card')
    expect(held).toContain('Get this ticket')
    expect(held).not.toContain('Get this membership card')
  })

  // A venue with one card never shows the chooser: the bare address is that
  // card's landing, one tap from the poster.
  it('goes straight to the landing when the venue publishes one card', () => {
    const only = soleCard({ ...venue, cards: [card.card] })
    const view = viewText(render({ card: only ?? card, kind: 'landing' }))

    expect(only?.card.slug).toBe('regular')
    expect(view).toContain('Get your free membership card')
    expect(view).not.toContain('Pick a card')
  })

  it('says so plainly when the venue publishes nothing yet', () => {
    const empty = viewText(render({ heldSlugs: [], kind: 'choose', venue: { ...venue, cards: [] } }))

    expect(empty).toContain('has no cards to hand out right now')
    expect(empty).not.toContain('Regular')
  })

  it('sends an unknown card address back to the venue, and says nothing when there is no venue', () => {
    const unknown = render({ kind: 'not_found', venue })
    const bare = render({ kind: 'not_found', venue: null })

    expect(viewText(unknown)).toMatch(/Wassie Coffee\s+has no card at this address/u)
    expect(viewNodes(unknown).map(({ props }) => props.href)).toContain('/@wassie-coffee')
    expect(viewText(bare)).toContain('There is no card at this address')
    expect(viewNodes(bare).map(({ props }) => props.href)).not.toContain('/@wassie-coffee')
  })
})

describe('a card outside its claim window', () => {
  const closed: PublicCard = { ...card, card: { ...card.card, claimable: false } }

  it('explains itself instead of offering a claim', () => {
    const text = viewText(render({ card: closed, kind: 'landing' }))
    expect(text).toContain('is not handing out this')
    expect(text).not.toContain('Get your free')
    expect(text).not.toContain('No sign-up')
  })

  it('offers the way back to the venue page', () => {
    const back = viewNodes(render({ card: closed, kind: 'landing' })).find(
      (node) => node.props.href === `/@${closed.handle}`,
    )
    expect(back).toBeDefined()
  })

  it('marks the row as closed on the venue page and keeps a held card openable', () => {
    const mixed: PublicVenue = { ...card, cards: [closed.card, { ...card.card, slug: 'other' }] }
    expect(viewText(render({ heldSlugs: [], kind: 'choose', venue: mixed }))).toContain(
      'Not being handed out right now',
    )
    const held = render({ heldSlugs: [closed.card.slug], kind: 'choose', venue: mixed })
    expect(viewText(held)).toContain('You have this card · Show it')
  })
})

describe('the venue mark', () => {
  it('renders the url the api handed out', () => {
    const marks = viewNodes(render({ card, kind: 'landing' })).filter(
      (node) => node.props.src === card.logoUrl,
    )
    expect(marks).toHaveLength(1)
  })

  it('renders no image for a venue without a mark', () => {
    const bare = { ...card, logoUrl: null }
    const marks = viewNodes(render({ card: bare, kind: 'landing' })).filter(
      (node) => node.props.src !== undefined,
    )
    expect(marks).toStrictEqual([])
  })
})
