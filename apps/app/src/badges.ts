import type { BadgeView, Hex } from '@fuda/sdk'
import { normalizeUid } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { apiFetch } from '@fuda/sdk/http'
import { any, CredentialRequest, IDKit, isInWorldApp } from '@worldcoin/idkit-core'
import type { ConstraintNode, CredentialType, IDKitRequest, RpContext } from '@worldcoin/idkit-core'

import { API_BASE_URL } from './config.ts'

// The whole point of this badge is that one human badges only one pass, which
// needs the same person verifying the same action twice to produce the same
// nullifier. World ID 4.0 gives exactly that: "the same person verifying the
// same action always produces the same nullifier", and the protocol's own type
// calls a nullifier "derived from (user, rpId, action)". The 4.0 migration
// guide's "one-time-use" wording is about not reusing a nullifier as a
// persistent cross-action identity — store the used ones — not about the value
// varying between requests; sessions randomise their action precisely *because*
// the nullifier is a function of it. Sources, all primary, in
// docs/research/world-id-2026-09-26.md Q3.
//
// Which credential proved it does not enter that derivation. The nullifier is
// `Poseidon2(DS_N, query, oprf_response)` over `query =
// oprf_query_digest(leaf_index, action, scope)` — the authenticator's merkle leaf
// index, the action and the rp id — while `issuer_schema_id` is mixed into a
// different OPRF module entirely (`CredentialBlindingFactor`). So asking for
// either of two credentials does not hand one person two nullifiers, which is
// what makes the request below safe to widen. Sources: world-id-protocol
// `crates/proof/src/oprf_query.rs` and
// `circom/client_side_proofs/oprf_nullifier.circom`.
//
// Two credentials are requested, not one. The event this ships for is in Japan,
// where many attendees hold the My Number Card credential and have never been to
// an Orb; requesting proof of human alone refuses them outright. `any()` is an
// OR whose order is priority order, so proof of human is offered first and My
// Number Card is the fallback. Adding passport later is one entry here and one
// in the api's own set.
//
// Legacy 3.0 proofs stay refused, and that is the constant that must not move
// alongside the credentials: `allow_legacy_proofs: true` would let one person
// hold a 3.0 nullifier and a distinct 4.0 nullifier for the same action, and
// badge a pass with each — the vendor's own type says "you must track both v3
// and v4 nullifiers to prevent double-claims". Exactly one family ships.
//
// None of this is enforceable from here: a client can ask for any credential it
// likes with the same server-issued `rp_context`, which the RP signature does
// not cover. The api makes the same choice again and refuses anything else —
// `PROTOCOL_VERSION` and `HUMAN_CREDENTIALS` in
// apps/api/src/badges/providers/world.ts. A change here without the matching
// change there rejects every proof this page produces.
const HUMAN_CREDENTIALS: readonly CredentialType[] = ['proof_of_human', 'mnc']
const ALLOW_LEGACY_PROOFS = false

// A constraint tree rather than a preset, because a preset names exactly one
// credential: `proofOfHuman()` returns `{ type: 'ProofOfHuman' }`, which is not
// a `ConstraintNode` and cannot be combined with another. `CredentialRequest`
// is the node form, and each node carries the signal, so both credentials bind
// to the same Right — idkit keys its cached signal hashes on the requested
// credential type, so whichever one answers has a hash to reattach.
const humanConstraints = (uid: Hex): ConstraintNode =>
  any(...HUMAN_CREDENTIALS.map((credential) => CredentialRequest(credential, { signal: uid })))

// Explicit, not left to idkit-core's default: the vendor's own integration
// guide has the client set this and the backend assert it ("Check that the
// verify response's `environment` matches your backend's expected
// environment (assert 'production' for production integrations)"), because
// `environment: 'staging'` is how its own simulator is requested. Written
// here beside the other two so a reader sees the client request and the
// server's `WORLD_ENVIRONMENT` assertion (world.ts) as one decision, not two
// unrelated defaults that happen to agree.
const WORLD_ENVIRONMENT = 'production'

// The RP-signed context POST /v1/badges/human/context hands back, opaque
// beyond the fields IDKit.request() itself needs.
export interface HumanBadgeContext {
  action: string
  app_id: `app_${string}`
  rp_context: RpContext
}

export interface HumanBadgeSubmission {
  badge: BadgeView
}

// A structural echo of idkit-core's `IDKitCompletionResult`: `result`/`error`
// are widened to `unknown`/`string` so this seam's own type does not require
// any file outside this module to import the vendor package to construct a
// fake one. The real value returned by `pollUntilCompletion()` is assignable
// to this type as-is.
export type HumanBadgeCompletion = { success: true; result: unknown } | { success: false; error: string }

// `waiting` carries the connector URI once there is one: the target the member
// opens to answer the request, which the page shows as a QR and as a link
// rather than navigating to it. It stays null inside World App, where the
// native transport needs no hand-off.
export type BadgeState =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'waiting'; connectorUri: string | null }
  | { kind: 'done' }
  | { kind: 'taken' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

// The three vendor-facing steps, injected so `requestHumanBadge` never talks
// to the real World SDK or network directly. `open` covers both opening World
// App and polling for its answer — from the caller's perspective those are
// one wait, not two round trips it needs to know about separately.
export interface HumanBadgeIo {
  context: () => Promise<Result<HumanBadgeContext>>
  // `onConnect` receives the connector URI as soon as the request exists and
  // before the wait for an answer begins, so the page can show the member how
  // to reach the verifier while it keeps polling. It is not called where the
  // transport completes on the device without a hand-off.
  open: (
    context: HumanBadgeContext,
    uid: Hex,
    onConnect: (connectorUri: string) => void,
  ) => Promise<HumanBadgeCompletion>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `payload` is the opaque, vendor-shaped proof from `open`; the api is the one place that parses it, this seam only forwards it
  submit: (uid: Hex, payload: unknown) => Promise<Result<HumanBadgeSubmission>>
}

// A user declining or backing out of World App is not an error — it just
// returns the member to where they started.
const CANCELLATION_ERRORS = new Set(['user_rejected', 'cancelled'])

// A member trying to badge a second pass is likelier to be stopped by World App
// than by fuda's 409: the nullifier is stable *and* 4.0 treats a second
// uniqueness proof of the same action as a replay, so the attempt usually ends
// in `nullifier_replayed` — "Nullifier was already used for this action. Treat
// as an already-verified outcome; do not retry the same action as a new
// verification" — before a proof ever exists to submit.
// `max_verifications_reached` is its sibling: "Action already verified the
// maximum allowed number of times. Treat as terminal business-rule outcome",
// which for an action that allows one verification per person is the same
// already-verified answer. Both belong on `taken`, the state whose copy says a
// pass of theirs is already verified, rather than on a generic failure. See
// docs/research/world-id-2026-09-26.md Q3 and Q7.
const ALREADY_VERIFIED_ERRORS = new Set(['nullifier_replayed', 'max_verifications_reached'])

// Both badge routes answer the same way on a config gap and on a repeat
// verification; the client tells them apart by status and error code alone,
// the same pattern `cardFailureOf` in api.ts already uses for the card routes.
const failureKind = (result: { error: string; status: number }): 'error' | 'taken' | 'unavailable' => {
  if (result.status === 409 && result.error === 'already_badged') {
    return 'taken'
  }
  if (result.status === 501) {
    return 'unavailable'
  }
  return 'error'
}

// The three outcomes a failed World App answer can mean to the member: a
// cancellation is not a failure at all, an already-verified answer is the same
// thing the api's 409 would have said, and anything else is a real error.
const completionFailureKind = (error: string): 'error' | 'idle' | 'taken' => {
  if (CANCELLATION_ERRORS.has(error)) {
    return 'idle'
  }
  if (ALREADY_VERIFIED_ERRORS.has(error)) {
    return 'taken'
  }
  return 'error'
}

export const defaultHumanBadgeIo: HumanBadgeIo = {
  context: async () =>
    await apiFetch<HumanBadgeContext>(API_BASE_URL, '/badges/human/context', { method: 'POST' }),
  open: async (context, uid, onConnect) => {
    // `.constraints()` has no World App v1 fallback where `.preset()` had one:
    // inside a World App whose verify transport predates v2 it rejects with
    // "verify v2 is not supported by this World App version". That is only one
    // of several ways this can reject — an expired or clock-skewed
    // `rp_context`, a rotated signing secret (`invalid_rp_signature`,
    // `unknown_rp`), a WASM init failure, or a bridge blocked by venue wifi all
    // land here too, and look identical to the member. `IDKit.request(...)` is
    // inside the same try as `.constraints()` so a synchronous throw there is
    // caught as well, instead of escaping and hanging the wait the way an
    // un-awaited rejection would. Reported as a completion failure it lands on
    // the error state with its copy, like any other failure to reach the
    // verifier. The rejection reason never reaches the member — only an
    // operator reading logs — so it is logged here rather than folded into the
    // member-facing state.
    let request: IDKitRequest | null
    try {
      request = await IDKit.request({
        ...context,
        allow_legacy_proofs: ALLOW_LEGACY_PROOFS,
        environment: WORLD_ENVIRONMENT,
      }).constraints(humanConstraints(uid))
    } catch (error) {
      // oxlint-disable-next-line no-console -- venue debugging needs the real rejection reason; the member never sees it, only the generic 'constraints_unsupported' state below
      console.error('[fuda-app] World ID verification request failed', error)
      request = null
    }
    if (request === null) {
      return { error: 'constraints_unsupported', success: false }
    }
    // Inside World App the native transport completes without a hand-off.
    // Everywhere else the page must survive the hand-off: `pollUntilCompletion()`
    // below only resolves while this document is alive, and `connectorURI` is an
    // ordinary https URL, not a custom scheme — assigning it to location.href
    // replaces the page on a desktop, and on any phone that does not claim that
    // URL, so a verification the member already completed is lost with nothing
    // shown. So the URI is handed to the page, which renders it as a QR and as a
    // link. A link the member taps is also a real user activation, which a
    // programmatic navigation is not, and it is what makes the mobile hand-off
    // reach World App at all.
    if (!isInWorldApp()) {
      onConnect(request.connectorURI)
    }
    return await request.pollUntilCompletion()
  },
  submit: async (uid, payload) =>
    await apiFetch<HumanBadgeSubmission>(API_BASE_URL, '/badges/human', {
      body: JSON.stringify({ payload, uid }),
      method: 'POST',
    }),
}

// Drives one verify-and-badge attempt, reporting each state to `onState` as
// it happens. `uid` is normalized to lowercase once here so the context call,
// the proof's signal, and the submitted body all agree with each other and
// with the api's own comparison (docs/specs, `normalizeUid`).
export const requestHumanBadge = async (
  io: HumanBadgeIo,
  uid: Hex,
  onState: (state: BadgeState) => void,
): Promise<void> => {
  const lowerUid = normalizeUid(uid) ?? uid
  onState({ kind: 'idle' })
  onState({ kind: 'opening' })
  const context = await io.context()
  if (!context.ok) {
    onState({ kind: failureKind(context) })
    return
  }
  onState({ connectorUri: null, kind: 'waiting' })
  const completion = await io.open(context.body, lowerUid, (connectorUri) => {
    onState({ connectorUri, kind: 'waiting' })
  })
  if (!completion.success) {
    onState({ kind: completionFailureKind(completion.error) })
    return
  }
  const submitted = await io.submit(lowerUid, completion.result)
  if (!submitted.ok) {
    onState({ kind: failureKind(submitted) })
    return
  }
  onState({ kind: 'done' })
}
