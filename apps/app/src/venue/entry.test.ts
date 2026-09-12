import type { PublicVenue } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { cardClaimHref, selectEntry } from './entry.ts'

const membership: PublicVenue['cards'][number] = {
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  description: '',
  id: 'm',
  slug: 'membership',
  title: 'Membership',
  validFrom: null,
  validUntil: null,
  validityDays: null,
}
const ticket = { ...membership, id: 't', slug: 'tasting', title: 'Tasting' }
const venue: PublicVenue = {
  brandColor: '#6F4320',
  cards: [membership, ticket],
  handle: 'coffee',
  logoUrl: null,
  name: 'Coffee',
  tagline: '',
}

describe(selectEntry, () => {
  it('selects a configured claimable default instead of another card', () => {
    expect(selectEntry({ ...venue, defaultCardSlug: 'tasting' })).toStrictEqual({
      kind: 'card',
      slug: 'tasting',
    })
  })

  it('selects the only claimable card without a configured default', () => {
    expect(selectEntry({ ...venue, cards: [{ ...membership, claimable: false }, ticket] })).toStrictEqual({
      kind: 'card',
      slug: 'tasting',
    })
  })

  it('asks members to choose when multiple cards are available', () => {
    expect(selectEntry(venue)).toStrictEqual({ defaultUnavailable: false, kind: 'choose' })
  })

  it('never silently substitutes another card for a closed or missing default', () => {
    expect(
      selectEntry({
        ...venue,
        cards: [{ ...membership, claimable: false }, ticket],
        defaultCardSlug: 'membership',
      }),
    ).toStrictEqual({ defaultUnavailable: true, kind: 'choose' })
    expect(selectEntry({ ...venue, defaultCardSlug: 'gone' })).toStrictEqual({
      defaultUnavailable: true,
      kind: 'choose',
    })
  })

  it('leaves empty and all-closed venues in the chooser', () => {
    expect(selectEntry({ ...venue, cards: [] })).toStrictEqual({ defaultUnavailable: false, kind: 'choose' })
    expect(selectEntry({ ...venue, cards: [{ ...membership, claimable: false }] })).toStrictEqual({
      defaultUnavailable: false,
      kind: 'choose',
    })
  })
})

describe(cardClaimHref, () => {
  it('keeps a legacy home card reachable without opening the store display', () => {
    expect(cardClaimHref('coffee', 'home')).toBe('/@coffee/card/home')
    expect(cardClaimHref('coffee', 'membership')).toBe('/@coffee/membership')
  })
})
