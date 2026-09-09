import { describe, expect, it } from 'vitest'

import {
  cardBySlug,
  cardSlugProblem,
  entitlementWindow,
  hasSingleValidityRule,
  isCardCategory,
  isCardSlug,
  isClaimable,
  isIssuerHandle,
  isOrderedWindow,
  issuerHandleProblem,
  normalizeBrandColor,
  slugFromTitle,
  soleCard,
} from './handles.ts'
import type { CardView } from './handles.ts'

describe('issuer handles', () => {
  it('accepts lowercase ascii with inner hyphens', () => {
    expect(isIssuerHandle('wassie-coffee')).toBe(true)
    expect(isIssuerHandle('a')).toBe(true)
    expect(isIssuerHandle('a'.repeat(63))).toBe(true)
  })

  it('rejects edge hyphens, upper case, length and reserved names', () => {
    expect(isIssuerHandle('-wassie')).toBe(false)
    expect(isIssuerHandle('Wassie')).toBe(false)
    expect(isIssuerHandle('a'.repeat(64))).toBe(false)
    expect(isIssuerHandle('issuers')).toBe(false)
    expect(isIssuerHandle('auth')).toBe(false)
  })

  it('reserves the static segments under /issuers so a venue stays reachable', () => {
    expect(isIssuerHandle('me')).toBe(false)
    expect(isIssuerHandle('check')).toBe(false)
    expect(isIssuerHandle('cards')).toBe(false)
  })

  it.each(['ab--cd', 'xn--coffee', '12--34', 'ab---cd'])(
    'rejects the ENSIP-15 reserved hyphen positions in %s',
    (handle) => {
      expect(issuerHandleProblem(handle)).toBe('format')
      expect(isIssuerHandle(handle)).toBe(false)
    },
  )

  it.each(['a--bc', 'abc--de', 'ab-c', 'a-b'])(
    'allows hyphens outside the ENSIP-15 reserved positions in %s',
    (handle) => {
      expect(isIssuerHandle(handle)).toBe(true)
    },
  )

  it('names the problem for a form', () => {
    expect(issuerHandleProblem('')).toBe('empty')
    expect(issuerHandleProblem('Wassie')).toBe('format')
    expect(issuerHandleProblem('api')).toBe('reserved')
    expect(issuerHandleProblem('wassie')).toBeNull()
  })
})

describe('brand colours and categories', () => {
  it('normalizes a hex colour and rejects anything else', () => {
    expect(normalizeBrandColor('#6f4320')).toBe('#6F4320')
    expect(normalizeBrandColor('6F4320')).toBeNull()
    expect(normalizeBrandColor('#fff')).toBeNull()
  })

  it('knows the two card categories', () => {
    expect(isCardCategory('membership')).toBe(true)
    expect(isCardCategory('ticket')).toBe(true)
    expect(isCardCategory('loyalty')).toBe(false)
  })
})

describe('card slugs', () => {
  it('uses the handle character rule and keeps future venue pages free', () => {
    expect(isCardSlug('stamp')).toBe(true)
    expect(isCardSlug('summer-2026')).toBe(true)
    expect(isCardSlug('ab--cd')).toBe(true)
    expect(isCardSlug('Stamp')).toBe(false)
    expect(isCardSlug('cards')).toBe(false)
  })

  it('names the problem for a form', () => {
    expect(cardSlugProblem('')).toBe('empty')
    expect(cardSlugProblem('-stamp')).toBe('format')
    expect(cardSlugProblem('settings')).toBe('reserved')
    expect(cardSlugProblem('stamp')).toBeNull()
  })

  it('suggests a slug from the card title', () => {
    expect(slugFromTitle('Membership Card')).toBe('membership-card')
    expect(slugFromTitle('  Summer Festival 2026!  ')).toBe('summer-festival-2026')
    expect(slugFromTitle('会員カード')).toBe('')
  })
})

// Every card view field, so a fixture names only what its test is about.
const card = (over: Partial<CardView>): CardView => ({
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  id: 'card',
  perk: '',
  reward: '',
  slug: 'card',
  title: 'Card',
  validFrom: null,
  validUntil: null,
  validityDays: null,
  ...over,
})

describe('choosing a card on the venue page', () => {
  const venue = {
    brandColor: '#6F4320',
    cards: [
      card({ category: 'membership', id: 'a', slug: 'stamp', title: 'Stamp' }),
      card({ category: 'ticket', id: 'b', slug: 'gig', title: 'Gig' }),
    ],
    handle: 'wassie-coffee',
    logoUrl: null,
    name: 'Wassie Coffee',
    tagline: '',
  }

  it('finds a card by its slug and reports an unknown one', () => {
    expect(cardBySlug(venue, 'gig')?.card.title).toBe('Gig')
    expect(cardBySlug(venue, 'nope')).toBeNull()
  })

  it('opens a single-card venue directly and makes a multi-card one choose', () => {
    expect(soleCard(venue)).toBeNull()
    expect(soleCard({ ...venue, cards: venue.cards.slice(0, 1) })?.card.slug).toBe('stamp')
    expect(soleCard({ ...venue, cards: [] })).toBeNull()
  })
})

describe('the claim window', () => {
  const open = { claimFrom: null, claimUntil: null }

  it('is open when neither end is set', () => {
    expect(isClaimable(open, 1000)).toBe(true)
  })

  it('closes before the start and after the end', () => {
    expect(isClaimable({ claimFrom: 500, claimUntil: null }, 400)).toBe(false)
    expect(isClaimable({ claimFrom: 500, claimUntil: null }, 500)).toBe(true)
    expect(isClaimable({ claimFrom: null, claimUntil: 500 }, 500)).toBe(true)
    expect(isClaimable({ claimFrom: null, claimUntil: 500 }, 501)).toBe(false)
  })

  it('refuses a window that ends before it starts', () => {
    expect(isOrderedWindow(500, 400)).toBe(false)
    expect(isOrderedWindow(400, 500)).toBe(true)
    expect(isOrderedWindow(null, 400)).toBe(true)
  })
})

describe(entitlementWindow, () => {
  it('counts a relative window from the moment the member claims it', () => {
    const window = entitlementWindow({ validFrom: null, validUntil: null, validityDays: 90 }, 1000)
    expect(window).toStrictEqual({ validFrom: 0, validUntil: 1000 + 90 * 86_400 })
  })

  it('keeps an absolute window whoever claims it and whenever', () => {
    const fixed = { validFrom: 5000, validUntil: 6000, validityDays: null }
    expect(entitlementWindow(fixed, 1000)).toStrictEqual({ validFrom: 5000, validUntil: 6000 })
    expect(entitlementWindow(fixed, 4000)).toStrictEqual({ validFrom: 5000, validUntil: 6000 })
  })

  it('is unbounded on both ends when the card sets no validity', () => {
    const window = entitlementWindow({ validFrom: null, validUntil: null, validityDays: null }, 1000)
    expect(window).toStrictEqual({ validFrom: 0, validUntil: 0 })
  })

  it('accepts one validity shape at a time', () => {
    expect(hasSingleValidityRule({ validFrom: null, validUntil: null, validityDays: 90 })).toBe(true)
    expect(hasSingleValidityRule({ validFrom: 1, validUntil: 2, validityDays: null })).toBe(true)
    expect(hasSingleValidityRule({ validFrom: null, validUntil: null, validityDays: null })).toBe(true)
    expect(hasSingleValidityRule({ validFrom: 1, validUntil: null, validityDays: 90 })).toBe(false)
  })
})
