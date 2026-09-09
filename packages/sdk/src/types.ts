import type { ErrorCode, Hex, Level, Reason } from './constants.ts'
import type { CardCategory, CardView, IssuerView, OperatorCardView } from './handles.ts'

export interface ErrorResponse {
  error: ErrorCode
}

export interface PassUrls {
  web: string
  google: string
  apple: string
}

export type IssueResponse =
  | { uid: Hex; level: 'bearer' | 'signed'; holder: Hex; qr: string; passUrls: PassUrls }
  | { uid: Hex; level: 'private'; announced: true; announceTx: Hex }

export interface EntitlementView {
  holder: Hex
  issuer: Hex
  usageModel: number
  tier: number
  level: number
  validFrom: number
  validUntil: number
  schemaVersion: number
}
export interface DelegationView {
  issuer: Hex
  active: boolean
  name: string
}

export interface VerifyResponse {
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  entitlement?: EntitlementView
  delegation?: DelegationView
}

export interface ChallengeResponse {
  challenge: string
  nonce: Hex
}

// Every /verify-signed verdict is 200 in this one shape (docs/specs/pass-types-and-flows.md#gate-protocol): no entitlement
// or delegation view, `stage` marks the two early stops, `holder` appears once the
// attestation was decoded.
export interface VerifySignedResponse {
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  path: 'signature'
  holder?: Hex
  stage?: 'entitlement' | 'challenge'
}

export interface MemberRow {
  uid: Hex
  memberId: string
  holder: Hex | null
  level: Level
  tier: number
  status: 'active' | 'revoked'
  createdAt: number
}
export interface MembersResponse {
  members: MemberRow[]
}
export interface RevokeResponse {
  revoked: true
  uid: Hex
}

// Operator sign-in (docs/specs/pass-types-and-flows.md#surfaces): a passkey
// wallet signs the api's message and receives a session token.
export interface SignInChallengeResponse {
  nonce: Hex
  message: string
}
export interface SignInResponse {
  token: string
  issuer: IssuerView | null
}
export interface MemberSessionResponse {
  address: Hex
}
export interface MemberSignInResponse extends MemberSessionResponse {
  token: string
}
export interface HandleCheckResponse {
  handle: string
  valid: boolean
  available: boolean
}
export interface CardCreateResponse {
  issuer: IssuerView
  card: CardView
  // the venue page; a card's own link is `${publicUrl}/${card.slug}`
  publicUrl: string
}
export interface CardUpdateResponse {
  card: OperatorCardView
}

// Derived from the Issuer's local immutable issuance snapshot, revocation
// marker and default slot. This is not a fresh chain verdict.
export type IssuerPassStatus = 'active' | 'revoked' | 'expired' | 'not_yet_valid' | 'consumed' | 'unknown'

export interface IssuerPassView {
  uid: string
  memberNumber: string
  card: { id: string; slug: string; title: string; category: CardCategory } | null
  holder: string | null
  claimedAt: number
  stamps: number
  status: IssuerPassStatus
  validFrom: number | null
  validUntil: number | null
}

export interface IssuerPassesResponse {
  passes: IssuerPassView[]
  page: { number: number; size: number; total: number }
  summary: { total: number; active: number; stamps: number; claimedLast30Days: number; unknown: number }
  cardStats: { cardId: string; issued: number; active: number; unknown: number }[]
}
// The operator's own venue. `cards` is a list because an issuer owns 0..N
// cards; venue registration precedes the first card.
export interface IssuerCardsResponse {
  issuer: IssuerView
  cards: CardView[]
  publicUrl: string
  // The venue's ENS name and how far its claim has got, or null while this
  // deployment has no ENS configured (docs/specs/ens-naming.md).
  ens: EnsClaimView | null
}
export type IssuerCreateResponse = IssuerCardsResponse
export interface IssuerUpdateResponse {
  issuer: IssuerView
}
export type IssuerMeResponse = IssuerCardsResponse | { issuer: null; cards: []; publicUrl: null; ens: null }

// `unclaimed` covers both "never asked" and a voucher that was signed and never
// used; either way the next step is the same, so the dashboard needs no third
// state for an abandoned prompt.
export interface EnsClaimView {
  name: string
  status: 'unclaimed' | 'claimed'
  claimTxHash: Hex | null
  expiry: number | null
}

// The self-serve Bearer issuance behind /@<handle>: the admin shape plus the
// generated member number the pass shows.
export interface CardCheckResponse {
  slug: string
  valid: boolean
  available: boolean
}

export interface SelfServeIssueResponse {
  uid: Hex
  level: 'bearer'
  holder: Hex
  qr: string
  passUrls: PassUrls
  memberNumber: string
}
