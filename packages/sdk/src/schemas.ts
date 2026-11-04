import * as v from 'valibot'

import { ADDRESS_RE, META_ADDRESS_RE, NONCE_RE, QR_RE, SIGNATURE_RE, UID_RE } from './constants.ts'
import {
  BRAND_COLOR_RE,
  CARD_CATEGORIES,
  CARD_IDENTITIES,
  CARD_RECORDS,
  CARD_DESCRIPTION_MAX_LENGTH,
  hasSingleValidityRule,
  isCardSlug,
  isCardSlugReference,
  isIdentityAllowed,
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

export type VerifyRequest = v.InferOutput<typeof VerifyBody>
export type RevokeRequest = v.InferOutput<typeof RevokeBody>
export type ChallengeRequest = v.InferOutput<typeof ChallengeBody>
const Base64Url = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+$/u))

const PasskeyResponseFields = {
  authenticatorAttachment: v.optional(v.picklist(['cross-platform', 'platform'])),
  clientExtensionResults: v.looseObject({}),
  id: Base64Url,
  rawId: Base64Url,
  type: v.literal('public-key'),
}

const Transport = v.picklist(['ble', 'hybrid', 'internal', 'nfc', 'usb'])

// What a browser's WebAuthn ceremony answers, in its JSON form. The contents are checked
// by the verifier; this only keeps malformed input from reaching it.
export const PasskeyRegistrationBody = v.object({
  ...PasskeyResponseFields,
  response: v.object({
    attestationObject: Base64Url,
    authenticatorData: v.optional(Base64Url),
    clientDataJSON: Base64Url,
    publicKey: v.optional(Base64Url),
    publicKeyAlgorithm: v.optional(v.number()),
    transports: v.optional(v.array(Transport)),
  }),
})

export const PasskeyAuthenticationBody = v.object({
  ...PasskeyResponseFields,
  response: v.object({
    authenticatorData: Base64Url,
    clientDataJSON: Base64Url,
    signature: Base64Url,
    userHandle: v.optional(Base64Url),
  }),
})

// The two ways to answer a gate challenge: a wallet's signature, or the passkey an
// Identified pass attests.
export const VerifySignedBody = v.union([
  v.object({
    nonce: v.pipe(v.string(), v.regex(NONCE_RE)),
    signature: v.pipe(v.string(), v.regex(SIGNATURE_RE)),
    uid,
  }),
  v.object({
    nonce: v.pipe(v.string(), v.regex(NONCE_RE)),
    uid,
    webauthn: PasskeyAuthenticationBody,
  }),
])
export type VerifySignedRequest = v.InferOutput<typeof VerifySignedBody>

// What a claim on a passkey card adds to the self-serve issue body.
export const PasskeyClaimBody = v.object({ webauthn: PasskeyAuthenticationBody })

// What a claim on a Sensitive card adds: the address of a key only the member can derive.
// It names no account.
export const SensitiveClaimBody = v.object({ holderAddress: address })

// docs/specs/pass-types-and-flows.md#sensitive-use. Ciphertext only: a wrapped 32-byte
// secret, and a vault of up to a few thousand short entries.
const SECRET_COPY_MAX_LENGTH = 128
const VAULT_MAX_LENGTH = 512_000
const AES_GCM_IV = v.pipe(Base64Url, v.length(16))

export const MemberSecretCopyBody = v.object({
  ciphertext: v.pipe(Base64Url, v.maxLength(SECRET_COPY_MAX_LENGTH)),
  credentialId: Base64Url,
  first: v.boolean(),
  iv: AES_GCM_IV,
})

export const MemberVaultBody = v.object({
  ciphertext: v.pipe(Base64Url, v.maxLength(VAULT_MAX_LENGTH)),
  expectedVersion: v.pipe(v.number(), v.integer(), v.minValue(0)),
  iv: AES_GCM_IV,
})

export const MemberSecretOutcomeBody = v.object({ outcome: v.picklist(['prf', 'no_prf']) })

export const MAX_LINKED_UIDS_PER_REQUEST = 50

export const LinkPassesBody = v.object({
  uids: v.pipe(v.array(v.string()), v.maxLength(MAX_LINKED_UIDS_PER_REQUEST)),
})

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
export const CARD_CAPACITY_MAX = 1_000_000

const CardFields = v.object({
  capacity: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(CARD_CAPACITY_MAX))),
    null,
  ),
  category: v.picklist(CARD_CATEGORIES),
  claimFrom: unixOrNull,
  claimUntil: unixOrNull,
  description: shortText(CARD_DESCRIPTION_MAX_LENGTH),
  identity: v.optional(v.picklist(CARD_IDENTITIES), 'none'),
  lockScreen: v.optional(v.boolean(), false),
  record: v.optional(v.picklist(CARD_RECORDS), 'offchain'),
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

// The label on a claim link: `?source=spring-flyer`.
export const ClaimSource = v.pipe(v.string(), v.regex(/^[a-z0-9_-]{1,40}$/u))

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
  v.check(
    (card: CardFieldsOutput) => isIdentityAllowed(card),
    'a pass bound to a key must be recorded offchain',
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

// POST /auth/switch — which of the account's issuers the new session acts for.
export const IssuerSwitchBody = v.strictObject({
  issuerId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
})
export type IssuerSwitchRequest = v.InferOutput<typeof IssuerSwitchBody>

export const DefaultCardBody = v.strictObject({
  slug: v.nullable(v.pipe(v.string(), v.check(isCardSlugReference))),
})

export type DefaultCardRequest = v.InferOutput<typeof DefaultCardBody>

export type SignInChallengeRequest = v.InferOutput<typeof SignInChallengeBody>
export type SignInVerifyRequest = v.InferOutput<typeof SignInVerifyBody>
export type CardRequest = v.InferOutput<typeof CardBody>
export type CardInput = v.InferInput<typeof CardBody>
export type CardUpdateRequest = v.InferOutput<typeof CardUpdateBody>
export type IssuerCreateRequest = v.InferOutput<typeof IssuerCreateBody>
export type IssuerCreateInput = v.InferInput<typeof IssuerCreateBody>
