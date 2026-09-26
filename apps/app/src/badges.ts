import type { BadgeView, Hex } from '@fuda/sdk'
import { normalizeUid } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { apiFetch } from '@fuda/sdk/http'
import { IDKit, isInWorldApp, orbLegacy } from '@worldcoin/idkit-core'
import type { RpContext } from '@worldcoin/idkit-core'

import { API_BASE_URL } from './config.ts'

// The whole point of this badge is that one human badges only one pass, which
// needs the same person verifying the same action twice to produce the same
// nullifier. World's own docs disagree on which credential gives that: see
// .superpowers/2026-09-26-world-spike-notes.md section 7 ("Step 6 — nullifier
// stability"), still an open item pending the user's phone measurement.
// Under the docs read so far, `orbLegacy` is the option credited with a
// stable per-(app_id, action) nullifier, so it is the current choice. These
// two constants must change together — if the measurement later favours
// `proofOfHuman`, swap both in one edit; never mix a 4.0 preset with a legacy
// `allow_legacy_proofs` value or the reverse.
//
// This choice is not enforceable from here: a client can ask for any preset it
// likes with the same server-issued `rp_context`, which the RP signature does
// not cover. The api makes the same choice again and refuses anything else —
// `PROTOCOL_VERSION` and `HUMAN_IDENTIFIERS` in
// apps/api/src/badges/providers/world.ts. A change here without the matching
// change there rejects every proof this page produces.
const HUMAN_PRESET = orbLegacy
const ALLOW_LEGACY_PROOFS = true

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

export const defaultHumanBadgeIo: HumanBadgeIo = {
  context: async () =>
    await apiFetch<HumanBadgeContext>(API_BASE_URL, '/badges/human/context', { method: 'POST' }),
  open: async (context, uid, onConnect) => {
    const request = await IDKit.request({
      ...context,
      allow_legacy_proofs: ALLOW_LEGACY_PROOFS,
      environment: WORLD_ENVIRONMENT,
    }).preset(HUMAN_PRESET({ signal: uid }))
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
    onState({ kind: CANCELLATION_ERRORS.has(completion.error) ? 'idle' : 'error' })
    return
  }
  const submitted = await io.submit(lowerUid, completion.result)
  if (!submitted.ok) {
    onState({ kind: failureKind(submitted) })
    return
  }
  onState({ kind: 'done' })
}
