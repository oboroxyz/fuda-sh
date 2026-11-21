import type { BadgeKind, ErrorCode, Hex, ISSUER_PASS_STATUSES, Level, Reason } from './constants.ts'
import type { CardCategory, CardView, IssuerView, OperatorCardView } from './handles.ts'
import type { RequirementKind, RequirementUnmet } from './requirements.ts'

export interface ErrorResponse {
  error: ErrorCode
}

export interface PassUrls {
  web: string
  google: string
  apple: string
}

// The venue card behind a public pass, for a client that draws the pass in the
// venue's own look (GET /pass/<uid>/card). `card` is null for an admin-issued
// right, which keeps the plain fuda look.
export interface PassCardView {
  artworkUrl: string | null
  issuerName: string
  cardTitle: string
  category: CardCategory
  // `#RRGGBB`
  brandColor: string
  // absolute and versioned, as the wallet passes link it; null for a venue without a mark
  logoUrl: string | null
  // display form (`QJ2Y-XPHE-PDRKA`)
  memberNumber: string
}

// An EAS offchain attestation in its stored JSON form: integers too large for a JSON
// number are decimal strings.
export interface OffchainAttestationJson {
  domain: { chainId: number; name: string; verifyingContract: string; version: string }
  message: {
    data: string
    expirationTime: string
    recipient: string
    refUID: string
    revocable: boolean
    salt: string
    schema: string
    time: string
    version: number
  }
  signature: string
  uid: string
}

// What a holder can keep and read back on their own. Having it means having the pass.
export interface PassBackup {
  version: 1
  uid: Hex
  qr: string
  holder: Hex
  // Null for a right with no venue card.
  handle: string | null
  slug: string | null
  memberNumber: string
  // Opens the pass on any device, with no account.
  restoreUrl: string | null
  // True for an Identified pass: this file brings back the record, but using the pass
  // still takes its passkey.
  passkey: boolean
  // The signed attestation, for an offchain right; null for an on-chain one, whose
  // record is on the chain.
  attestation: OffchainAttestationJson | null
  // Null until the pass's batch has been timestamped.
  proof: { root: Hex; path: Hex[]; anchoredAt: number } | null
}

export interface PassCardResponse {
  card: PassCardView | null
}

export interface IssueResponse {
  uid: Hex
  level: 'bearer' | 'signed'
  holder: Hex
  qr: string
  passUrls: PassUrls
}

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

// A verified fact about the Member holding a Right, attached after issuance
// (docs/CONTEXT.md: Badge). An array from the first version: this type is
// public and a second kind must not be a breaking change.
export interface BadgeView {
  kind: BadgeKind
  verifier: string
  at: number
  expiresAt?: number
}

export interface VerifyResponse {
  requirement?: RequirementUnmet
  requirements?: { kind: RequirementKind; evidence: string }[]
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  entitlement?: EntitlementView
  delegation?: DelegationView
  badges?: BadgeView[]
  // An ADMIT whose on-chain revocation could not be read: a membership card still
  // enters, and fuda's own revocation record was checked. Absent otherwise.
  unconfirmed?: true
}

export interface ChallengeResponse {
  challenge: string
  nonce: Hex
  // For an Identified pass: the request for the browser's passkey prompt. Its challenge
  // is the base64url of `challenge`, and it names only the attested credential.
  webauthn?: PasskeyRequestOptions
}

export interface PasskeyRequestOptions {
  allowCredentials?: { id: string; type: 'public-key' }[]
  challenge: string
  rpId?: string
  timeout?: number
  userVerification?: 'discouraged' | 'preferred' | 'required'
}

// Every /verify-signed verdict is 200 in this one shape (docs/specs/pass-types-and-flows.md#gate-protocol): no entitlement
// or delegation view, `stage` marks the two early stops, `holder` appears once the
// attestation was decoded.
// The addresses that applied for a Card with requirements, oldest first. `next` is the
// `after` value of the following page, or null on the last one.
export interface CardApplicantsResponse {
  applicants: { address: string; appliedAt: number }[]
  next: string | null
}

export interface VerifySignedResponse {
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  path: 'signature'
  requirement?: RequirementUnmet
  requirements?: { kind: RequirementKind; evidence: string }[]
  venue?: string
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
  // A Sensitive pass, which has no page, QR or Wallet pass to hand out. Absent otherwise.
  sensitive?: true
  // The Badges this Right carries, for an operator surface that shows the fact
  // of a Badge beside the Right. An array rather than a `human` flag, for the
  // same reason `VerifyResponse.badges` is one: a second kind must not be a
  // breaking change. Absent, never empty, when the Right carries none, so a
  // row keeps the exact shape it had before Badges existed.
  badges?: BadgeView[]
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
export interface OperatorSignInResponse extends SignInResponse {
  accountId: string
}
// A session names an account or the wallet that signed in, never both.
export type OperatorMeResponse = { accountId: string; address: null } | { accountId: null; address: Hex }
export interface MemberSessionResponse {
  accountId: string
}
export interface MemberSignInResponse extends MemberSessionResponse {
  token: string
}
export interface PasskeyView {
  id: string
  backedUp: boolean
  createdAt: number
  // Whether this passkey holds a copy of the member secret, so it can open Sensitive passes.
  holdsSecret: boolean
  lastUsedAt: number | null
}
export interface PasskeysResponse {
  passkeys: PasskeyView[]
}
// docs/specs/pass-types-and-flows.md#sensitive-use
export interface MemberSecretCopyView {
  ciphertext: string
  credentialId: string
  iv: string
}
export interface MemberSecretResponse {
  // Only passkeys with a copy, once there is one, so the prompt offers no passkey that
  // cannot open it.
  allowCredentials: { id: string; transports: string[] }[]
  copies: MemberSecretCopyView[]
  rpId: string
}
export interface MemberVaultView {
  ciphertext: string
  iv: string
  version: number
}
export interface MemberVaultResponse {
  vault: MemberVaultView | null
}
export interface MemberPassView {
  uid: Hex
  holder: Hex
  addedAt: number
}
export interface MemberPassesResponse {
  passes: MemberPassView[]
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

export type IssuerPassStatus = (typeof ISSUER_PASS_STATUSES)[number]

export interface IssuerPassView {
  uid: string
  memberNumber: string
  card: { id: string; slug: string; title: string; category: CardCategory } | null
  holder: string | null
  claimedAt: number
  // the claim link's label, or null; self-reported, so good for counting only
  source: string | null
  stamps: number
  status: IssuerPassStatus
  validFrom: number | null
  validUntil: number | null
  // The Badges this Right carries, on the same terms as `MemberRow.badges`: a
  // list rather than a `human` flag, and absent rather than empty when the Right
  // carries none, so a row keeps the shape it had before Badges existed.
  badges?: BadgeView[]
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
// `token` is present when the account already acted for another issuer: a new
// session bound to the new issuer, leaving the caller's own session — and any
// other tab holding it — on the issuer it had (../../../docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
export type IssuerCreateResponse = IssuerCardsResponse & { token?: string }
export interface IssuerUpdateResponse {
  issuer: IssuerView
}
export interface DefaultCardResponse {
  issuer: IssuerView
}
export type IssuerMeResponse = (
  | IssuerCardsResponse
  | { issuer: null; cards: []; publicUrl: null; ens: null }
) & { requirementRegistries?: string[] }

// POST /auth/switch — a new session bound to the chosen issuer. The session
// that asked keeps its own issuer: a token never changes which issuer it acts
// for (../../../docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
export interface IssuerSwitchResponse {
  token: string
  operator: IssuerMeResponse
}

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
  level: 'bearer' | 'signed'
  holder: Hex
  qr: string
  passUrls: PassUrls
  memberNumber: string
}
