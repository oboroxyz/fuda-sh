import type { Hex } from './constants.ts'

// The issuer Handle (docs/specs/ens-naming.md): the `/@<handle>` slug and the
// ENS issuer label, lowercase ASCII `[a-z0-9-]`, 1–63 bytes, no edge hyphen.
const ISSUER_HANDLE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u
export const ISSUER_HANDLE_MAX_LENGTH = 63

// Names a handle must never take: fuda's own hosts and the api route prefixes,
// so `/@auth` can never shadow `/auth` on any surface.
export const RESERVED_ISSUER_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'challenge',
  'dash',
  'ens',
  'fuda',
  'gate',
  'health',
  'issue',
  'issuers',
  'members',
  'pass',
  'private',
  'revoke',
  'rights',
  'signed',
  'verify',
  'www',
])

export const isIssuerHandle = (raw: string): boolean =>
  raw.length <= ISSUER_HANDLE_MAX_LENGTH && ISSUER_HANDLE.test(raw) && !RESERVED_ISSUER_HANDLES.has(raw)

// Why a handle was rejected, for a form to explain; null when it is usable.
export const issuerHandleProblem = (raw: string): 'empty' | 'format' | 'reserved' | null => {
  if (raw === '') {
    return 'empty'
  }
  if (raw.length > ISSUER_HANDLE_MAX_LENGTH || !ISSUER_HANDLE.test(raw)) {
    return 'format'
  }
  return RESERVED_ISSUER_HANDLES.has(raw) ? 'reserved' : null
}

// `#RRGGBB`, upper-cased so two spellings of one colour compare equal.
const BRAND_COLOR = /^#[0-9a-fA-F]{6}$/u
export const normalizeBrandColor = (raw: string): string | null =>
  BRAND_COLOR.test(raw) ? raw.toUpperCase() : null

// A card's slug is the path segment under the venue: `fuda.sh/@<handle>/<slug>`.
// It uses the Handle's character rule so one poster URL reads the same way
// throughout, but it is NOT an ENS label: the ENS hierarchy stays
// `<member-no>.<issuer>.fuda.eth` and never carries a card
// (docs/specs/ens-naming.md).
export const CARD_SLUG_MAX_LENGTH = 63

// Reserved so a card can never shadow a future page under the venue.
export const RESERVED_CARD_SLUGS: ReadonlySet<string> = new Set(['card', 'cards', 'issue', 'settings'])

export const isCardSlug = (raw: string): boolean =>
  raw.length <= CARD_SLUG_MAX_LENGTH && ISSUER_HANDLE.test(raw) && !RESERVED_CARD_SLUGS.has(raw)

export const cardSlugProblem = (raw: string): 'empty' | 'format' | 'reserved' | null => {
  if (raw === '') {
    return 'empty'
  }
  if (raw.length > CARD_SLUG_MAX_LENGTH || !ISSUER_HANDLE.test(raw)) {
    return 'format'
  }
  return RESERVED_CARD_SLUGS.has(raw) ? 'reserved' : null
}

// The slug a card title suggests, so an operator rarely types one by hand.
// An empty result means the title carried nothing usable and the operator
// must choose the slug themselves.
export const slugFromTitle = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, CARD_SLUG_MAX_LENGTH)
    .replaceAll(/-+$/gu, '')

export type CardCategory = 'membership' | 'ticket'
export const CARD_CATEGORIES: readonly CardCategory[] = ['membership', 'ticket']
export const isCardCategory = (raw: string): raw is CardCategory =>
  CARD_CATEGORIES.some((category) => category === raw)

export interface CardView {
  id: string
  slug: string
  title: string
  category: CardCategory
  perk: string
  reward: string
  validityDays: number | null
}

export interface IssuerView {
  id: string
  handle: string
  name: string
  tagline: string
  brandColor: string
  operatorAddress: Hex
  createdAt: number
}

// GET /issuers/:handle — the venue page a member lands on. A venue with one
// card goes straight to it; with several, the member picks one.
export interface PublicVenue {
  handle: string
  name: string
  tagline: string
  brandColor: string
  cards: CardView[]
}

// One card of that venue, once the member (or the link) has chosen it.
export interface PublicCard extends Omit<PublicVenue, 'cards'> {
  card: CardView
}

export const cardBySlug = (venue: PublicVenue, slug: string): PublicCard | null => {
  const card = venue.cards.find((entry) => entry.slug === slug)
  return card === undefined ? null : { ...venue, card }
}

// The card a bare `/@<handle>` opens: the only one, or none when the member
// must choose.
export const soleCard = (venue: PublicVenue): PublicCard | null =>
  venue.cards.length === 1 ? cardBySlug(venue, venue.cards[0]?.slug ?? '') : null
