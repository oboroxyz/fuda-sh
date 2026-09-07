import { describe, expect, it } from 'vitest'

import {
  cardBySlug,
  cardSlugProblem,
  isCardCategory,
  isCardSlug,
  isIssuerHandle,
  issuerHandleProblem,
  normalizeBrandColor,
  slugFromTitle,
  soleCard,
} from './handles.ts'

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

describe('choosing a card on the venue page', () => {
  const venue = {
    brandColor: '#6F4320',
    cards: [
      { category: 'membership' as const, id: 'a', perk: '', reward: '', slug: 'stamp', title: 'Stamp', validityDays: null },
      { category: 'ticket' as const, id: 'b', perk: '', reward: '', slug: 'gig', title: 'Gig', validityDays: null },
    ],
    handle: 'wassie-coffee',
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
