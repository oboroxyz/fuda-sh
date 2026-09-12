import type { PublicVenue } from '@fuda/sdk'

export type VenueEntryChoice =
  | { kind: 'card'; slug: string }
  | { kind: 'choose'; defaultUnavailable: boolean }

export const selectEntry = (venue: PublicVenue): VenueEntryChoice => {
  if (venue.defaultCardSlug !== null && venue.defaultCardSlug !== undefined) {
    const card = venue.cards.find(({ slug }) => slug === venue.defaultCardSlug)
    return card?.claimable === true
      ? { kind: 'card', slug: card.slug }
      : { defaultUnavailable: true, kind: 'choose' }
  }
  const available = venue.cards.filter(({ claimable }) => claimable)
  const [card] = available
  return available.length === 1 && card !== undefined
    ? { kind: 'card', slug: card.slug }
    : { defaultUnavailable: false, kind: 'choose' }
}

export const cardClaimHref = (handle: string, slug: string): string =>
  `/@${handle}/${slug === 'home' ? 'card/home' : slug}`
