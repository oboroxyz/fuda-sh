import { normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { signRequest } from '@worldcoin/idkit-server'
import * as v from 'valibot'

import type { Bindings } from '../../env.ts'
import type { BadgeVerifier, VerifiedSubject } from '../verifier.ts'

const VERIFY_BASE = 'https://developer.world.org/api/v4/verify'

const set = (value: string | undefined): value is string => value !== undefined && value !== ''

// The four World bindings, all-or-nothing. Read once here so `configured()`
// and `context()` narrow the same way instead of each re-deriving it — that
// keeps the narrowing real (no assertion needed) across both call sites.
interface WorldConfig {
  appId: string
  rpId: string
  action: string
  signingKeyHex: string
}

const configOf = (env: Bindings): WorldConfig | null => {
  const { WORLD_ACTION, WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY } = env
  if (!set(WORLD_APP_ID) || !set(WORLD_RP_ID) || !set(WORLD_ACTION) || !set(WORLD_RP_SIGNING_KEY)) {
    return null
  }
  return { action: WORLD_ACTION, appId: WORLD_APP_ID, rpId: WORLD_RP_ID, signingKeyHex: WORLD_RP_SIGNING_KEY }
}

// The proof payload's only field this adapter cares about at the I/O boundary:
// the signal the client bound into the proof. Everything else is opaque and
// forwarded to the portal as-is.
const PayloadSignal = v.looseObject({ signal: v.string() })

// The signal, in the one canonical form both sides agree on. A checksummed or
// upper-cased uid here reads like a bad proof.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this *is* the I/O boundary: `payload` is an opaque, vendor-shaped proof and `PayloadSignal` is the parser that decodes it
const signalOf = (payload: unknown): Hex | null => {
  const parsed = v.safeParse(PayloadSignal, payload)
  return parsed.success ? normalizeUid(parsed.output.signal) : null
}

// The one field of the portal's verify response this adapter reads. PROVISIONAL:
// the verify response shape is not shipped by either World package (only the
// client-side IDKitResultV4 type carries `nullifier`, and the public docs show
// it echoed in the response). Confirm or correct this field name against a real
// Portal response before shipping; see
// .superpowers/2026-09-26-world-spike-notes.md section 6, which was still
// unfilled by the user at the time this adapter was written.
const VerifyResponseNullifier = v.looseObject({ nullifier: v.pipe(v.string(), v.minLength(1)) })

export const worldVerifier: BadgeVerifier = {
  configured: (env) => configOf(env) !== null,
  context: async (env) => {
    const config = configOf(env)
    if (config === null) {
      // Routes (next task) must check `configured()` before calling this; a
      // call with a missing binding is a caller bug, not a user-facing 501.
      throw new Error('world verifier: context() called while unconfigured')
    }
    // signRequest()'s output is not shaped like RpContext: sig -> signature,
    // createdAt -> created_at, expiresAt -> expires_at, and rp_id is added
    // here (it never comes from signRequest). See
    // .superpowers/2026-09-26-world-spike-notes.md section 3, and
    // apps/api/scripts/world-spike.ts, which established this mapping.
    // The signing key never leaves this call: it is a Worker secret and
    // never reaches a client, a log, or a response body.
    const signed = signRequest({ action: config.action, signingKeyHex: config.signingKeyHex })
    // signRequest() itself is synchronous; the await is only to satisfy the
    // interface's `Promise<unknown>` contract (the caller always awaits
    // `context()`, matching the pattern a future non-World verifier may need).
    return await Promise.resolve({
      action: config.action,
      app_id: config.appId,
      rp_context: {
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        nonce: signed.nonce,
        rp_id: config.rpId,
        signature: signed.sig,
      },
    })
  },
  kind: 'human',
  name: 'world',
  verify: async (env, input) => {
    const config = configOf(env)
    if (config === null) {
      throw new Error('world verifier: verify() called while unconfigured')
    }
    if (signalOf(input.payload) !== input.uid) {
      return { error: 'bad_input' }
    }
    const res = await fetch(`${VERIFY_BASE}/${config.rpId}`, {
      body: JSON.stringify(input.payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    if (!res.ok) {
      return { error: 'bad_proof' }
    }
    const body: unknown = await res.json()
    const parsed = v.safeParse(VerifyResponseNullifier, body)
    if (!parsed.success) {
      return { error: 'bad_proof' }
    }
    return {
      credential: 'orb',
      expiresAt: null,
      scope: config.action,
      subjectKey: parsed.output.nullifier.toLowerCase(),
    } satisfies VerifiedSubject
  },
}
