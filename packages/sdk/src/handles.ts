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

export type CardCategory = 'membership' | 'ticket'
export const CARD_CATEGORIES: readonly CardCategory[] = ['membership', 'ticket']
export const isCardCategory = (raw: string): raw is CardCategory =>
  CARD_CATEGORIES.some((category) => category === raw)

export interface CardView {
  id: string
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

// GET /issuers/:handle — what a member sees before asking for a card.
export interface PublicCard {
  handle: string
  name: string
  tagline: string
  brandColor: string
  card: CardView
}
