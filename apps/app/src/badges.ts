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
const HUMAN_PRESET = orbLegacy
const ALLOW_LEGACY_PROOFS = true

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

export type BadgeState =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'waiting' }
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
  open: (context: HumanBadgeContext, uid: Hex) => Promise<HumanBadgeCompletion>
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
  open: async (context, uid) => {
    const request = await IDKit.request({ ...context, allow_legacy_proofs: ALLOW_LEGACY_PROOFS }).preset(
      HUMAN_PRESET({ signal: uid }),
    )
    // Inside World App the native transport completes without a redirect;
    // everywhere else the connector URI is the deep link/QR target that opens it.
    if (!isInWorldApp()) {
      globalThis.location.href = request.connectorURI
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
  onState({ kind: 'waiting' })
  const completion = await io.open(context.body, lowerUid)
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
