import * as v from 'valibot'

import { ADDRESS_RE, META_ADDRESS_RE, NONCE_RE, QR_RE, SIGNATURE_RE, UID_RE } from './constants.ts'
import {
  BRAND_COLOR_RE,
  CARD_CATEGORIES,
  CARD_DESCRIPTION_MAX_LENGTH,
  hasSingleValidityRule,
  isCardSlug,
  isIssuerHandle,
  isOrderedWindow,
  normalizeBrandColor,
} from './handles.ts'

const uid = v.pipe(v.string(), v.regex(UID_RE))
const address = v.pipe(v.string(), v.regex(ADDRESS_RE))
const unix = v.pipe(v.number(), v.integer(), v.minValue(0))

export const IssueBody = v.object({
  holder: v.optional(address),
  memberId: v.optional(v.pipe(v.string(), v.minLength(1))),
  metaURI: v.optional(v.string(), ''),
  stealthMetaAddress: v.optional(v.pipe(v.string(), v.regex(META_ADDRESS_RE))),
  tier: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3)), 0),
  usageModel: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2)), 1),
  validFrom: v.optional(unix, 0),
  validUntil: v.optional(unix, 0),
})
export type IssueRequest = v.InferOutput<typeof IssueBody>

// Exact rule from docs/specs/attestation-model.md#api-payloads-that-touch-attestations: stealthMetaAddress → private (holder forbidden);
// else holder → signed (memberId forbidden); else memberId → bearer; else null.
export const deriveIssueKind = (b: IssueRequest): 'bearer' | 'signed' | 'private' | null => {
  if (b.stealthMetaAddress !== undefined) {
    return b.holder === undefined ? 'private' : null
  }
  if (b.holder !== undefined) {
    return b.memberId === undefined ? 'signed' : null
  }
  return b.memberId === undefined ? null : 'bearer'
}

export const VerifyBody = v.object({ qr: v.pipe(v.string(), v.regex(QR_RE)) })
export const RevokeBody = v.object({ uid })
export const ChallengeBody = v.object({ uid })
export const VerifySignedBody = v.object({
  nonce: v.pipe(v.string(), v.regex(NONCE_RE)),
  signature: v.pipe(v.string(), v.regex(SIGNATURE_RE)),
  uid,
})

export type VerifyRequest = v.InferOutput<typeof VerifyBody>
export type RevokeRequest = v.InferOutput<typeof RevokeBody>
export type ChallengeRequest = v.InferOutput<typeof ChallengeBody>
export type VerifySignedRequest = v.InferOutput<typeof VerifySignedBody>

export const SignInChallengeBody = v.object({ address })
export const SignInVerifyBody = v.object({
  address,
  nonce: v.pipe(v.string(), v.regex(NONCE_RE)),
  signature: v.pipe(v.string(), v.regex(SIGNATURE_RE)),
})

const coordinate = (max: number) => v.pipe(v.number(), v.minValue(-max), v.maxValue(max))
const shortText = (max: number) => v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max)), '')

const unixOrNull = v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))), null)

// One card of a venue. `slug` is its path segment under the handle, so a
// poster can link straight to this card at `fuda.sh/@<handle>/<slug>`. The
// claim window says when the card is handed out; the validity fields say how
// long the resulting right lasts, in exactly one of the two shapes.
const CardFields = v.object({
  category: v.picklist(CARD_CATEGORIES),
  claimFrom: unixOrNull,
  claimUntil: unixOrNull,
  description: shortText(CARD_DESCRIPTION_MAX_LENGTH),
  lockScreen: v.optional(v.boolean(), false),
  slug: v.pipe(v.string(), v.check(isCardSlug)),
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
  validFrom: unixOrNull,
  validUntil: unixOrNull,
  validityDays: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650))),
    null,
  ),
  venue: v.optional(v.object({ lat: coordinate(90), lng: coordinate(180) })),
})

type CardFieldsOutput = v.InferOutput<typeof CardFields>

export const CardBody = v.pipe(
  CardFields,
  v.check(
    (card: CardFieldsOutput) => hasSingleValidityRule(card),
    'a card expires either after N days or between two dates, not both',
  ),
  v.check(
    (card: CardFieldsOutput) => isOrderedWindow(card.claimFrom, card.claimUntil),
    'the claim window cannot end before it starts',
  ),
  v.check(
    (card: CardFieldsOutput) => isOrderedWindow(card.validFrom, card.validUntil),
    'the validity window cannot end before it starts',
  ),
)

// Editing replaces the complete mutable Card state while preserving its id,
// issuer, slug and creation time. Strictness makes those immutable fields (and
// any future unknown field) a bad request instead of silently ignoring them.
const CardUpdateFields = v.strictObject({
  category: CardFields.entries.category,
  claimFrom: v.nullable(unix),
  claimUntil: v.nullable(unix),
  description: v.pipe(v.string(), v.trim(), v.maxLength(CARD_DESCRIPTION_MAX_LENGTH)),
  lockScreen: v.boolean(),
  title: CardFields.entries.title,
  validFrom: v.nullable(unix),
  validUntil: v.nullable(unix),
  validityDays: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650))),
  venue: CardFields.entries.venue,
})

type CardUpdateFieldsOutput = v.InferOutput<typeof CardUpdateFields>

export const CardUpdateBody = v.pipe(
  CardUpdateFields,
  v.check(
    (card: CardUpdateFieldsOutput) => hasSingleValidityRule(card),
    'a card expires either after N days or between two dates, not both',
  ),
  v.check(
    (card: CardUpdateFieldsOutput) => isOrderedWindow(card.claimFrom, card.claimUntil),
    'the claim window cannot end before it starts',
  ),
  v.check(
    (card: CardUpdateFieldsOutput) => isOrderedWindow(card.validFrom, card.validUntil),
    'the validity window cannot end before it starts',
  ),
)

// POST /issuers — venue registration, validated identically in the dashboard
// and the api. Cards are published separately after the venue claims its ENS
// name. `handle` is checked by the shared rule; the api adds availability.
export const IssuerCreateBody = v.object({
  // Canonicalized here rather than at each writer, so D1 never holds two
  // spellings of one colour.
  brandColor: v.pipe(
    v.string(),
    v.regex(BRAND_COLOR_RE),
    v.transform((raw) => normalizeBrandColor(raw) ?? raw),
  ),
  handle: v.pipe(v.string(), v.check(isIssuerHandle)),
  // a staged logo from POST /issuers/logo, committed with the venue
  logoUploadId: v.optional(v.nullable(v.pipe(v.string(), v.minLength(1))), null),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  tagline: shortText(120),
})

// Display fields can change after registration; identity and logo writes have
// separate contracts. Reject extra keys so a handle change is never ignored.
export const IssuerUpdateBody = v.strictObject({
  brandColor: IssuerCreateBody.entries.brandColor,
  name: IssuerCreateBody.entries.name,
  tagline: IssuerCreateBody.entries.tagline,
})

export type IssuerUpdateRequest = v.InferOutput<typeof IssuerUpdateBody>

export type SignInChallengeRequest = v.InferOutput<typeof SignInChallengeBody>
export type SignInVerifyRequest = v.InferOutput<typeof SignInVerifyBody>
export type CardRequest = v.InferOutput<typeof CardBody>
export type CardInput = v.InferInput<typeof CardBody>
export type CardUpdateRequest = v.InferOutput<typeof CardUpdateBody>
export type IssuerCreateRequest = v.InferOutput<typeof IssuerCreateBody>
export type IssuerCreateInput = v.InferInput<typeof IssuerCreateBody>
