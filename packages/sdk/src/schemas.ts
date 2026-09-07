import * as v from 'valibot'

import { ADDRESS_RE, META_ADDRESS_RE, NONCE_RE, QR_RE, SIGNATURE_RE, UID_RE } from './constants.ts'
import { CARD_CATEGORIES, isIssuerHandle } from './handles.ts'

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

// POST /issuers — the card designer's form, validated identically in the
// dashboard and the api. `handle` is checked by the shared rule; the api adds
// availability on top.
export const IssuerCreateBody = v.object({
  brandColor: v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/u)),
  card: v.object({
    category: v.picklist(CARD_CATEGORIES),
    lockScreen: v.optional(v.boolean(), false),
    perk: shortText(120),
    reward: shortText(120),
    title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
    validityDays: v.optional(
      v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650))),
      null,
    ),
    venue: v.optional(v.object({ lat: coordinate(90), lng: coordinate(180) })),
  }),
  handle: v.pipe(v.string(), v.check(isIssuerHandle)),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  tagline: shortText(120),
})

export type SignInChallengeRequest = v.InferOutput<typeof SignInChallengeBody>
export type SignInVerifyRequest = v.InferOutput<typeof SignInVerifyBody>
export type IssuerCreateRequest = v.InferOutput<typeof IssuerCreateBody>
export type IssuerCreateInput = v.InferInput<typeof IssuerCreateBody>
