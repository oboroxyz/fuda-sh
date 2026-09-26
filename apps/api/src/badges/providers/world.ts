// The `/hashing` subpath on purpose: it is pure TypeScript over @noble/hashes,
// while the package root pulls in idkit's wasm bundle, which has no business in
// a Worker. `hashSignal` is the same function World App itself uses to derive
// the `signal_hash` carried in a proof — its wasm and JS implementations were
// compared byte for byte over 0x-prefixed hex, plain strings and invalid hex
// before this adapter was written to depend on their agreement.
import { hashSignal } from '@worldcoin/idkit-core/hashing'
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

// The proof payload as the vendor actually ships it: `IDKitResult` from
// @worldcoin/idkit-core, forwarded verbatim by the client. There is no
// top-level `signal` field anywhere in that type — the signal reaches the
// server only as `responses[].signal_hash`, so that is what this adapter
// checks. Everything else is opaque and goes to the portal as-is.
//
// `signal_hash` is optional in the vendor's type ("included if signal was
// provided in request") but required here: a response item carrying no signal
// hash is a proof bound to nothing, which is exactly the proof-theft the
// signal exists to prevent. A missing hash therefore fails this parse.
const ProofPayload = v.looseObject({
  environment: v.string(),
  protocol_version: v.string(),
  responses: v.array(v.looseObject({ identifier: v.string(), signal_hash: v.string() })),
})

// The one protocol family this deployment accepts, and the server-side half of
// the choice made once in apps/app/src/badges.ts (`HUMAN_PRESET`). `orbLegacy`
// "only returns World ID 3.0 proofs" per its own vendor JSDoc, so 3.0 is the
// family. Accepting 4.0 as well would let one person obtain a second,
// unrelated nullifier for the same action and badge a second pass — the vendor
// says as much on `allow_legacy_proofs` ("you must track both v3 and v4
// nullifiers to prevent double-claims"). The client preset and this constant
// change together or not at all.
const PROTOCOL_VERSION = '3.0'

// The one environment this deployment accepts. idkit-core's own type also
// allows 'staging' and 'sandbox' (its test and demo modes), and every proof
// result carries whichever one produced it. World's own integration guide
// prescribes exactly this check ("Check that the verify response's
// `environment` matches your backend's expected environment (assert
// 'production' for production integrations)"), because `environment:
// 'staging'` is how its own simulator is requested — a staging or sandbox
// proof is not backed by a real Orb verification, so accepting one would make
// the one-human-one-pass claim this feature exists to make meaningless. The
// client sets the matching `environment: 'production'` on its request; see
// `WORLD_ENVIRONMENT` in apps/app/src/badges.ts.
const WORLD_ENVIRONMENT = 'production'

// Which credentials count as "one verified human" in the 3.0 family. World App
// reports the Orb credential as `orb` over the native transport (idkit maps
// `verification_level` through unchanged), while the vendor's own
// `ResponseItemV3` doc gives `proof_of_human` as an example identifier and the
// bridge transport builds that field inside the wasm, where it cannot be read.
// Both spellings of the same credential are accepted for that reason; nothing
// else is. `device`, `document`, `secure_document`, `face`/`selfie`,
// `passport`, `mnc` and `eid` are different credentials with different
// uniqueness strength, and a payload carrying one means the client asked for a
// preset this feature did not ship.
const HUMAN_IDENTIFIERS = new Set(['orb', 'proof_of_human'])

// Both sides of the comparison in one form, so a 0x prefix or an upper-cased
// digit cannot read as a different signal. `hashSignal` returns 0x-prefixed
// lowercase hex, padded to 32 bytes, on both the JS and the wasm side; this
// only guards the payload half, which arrives from a client.
const bareHash = (hash: string): string => hash.replace(/^0x/iu, '').toLowerCase()

const sameHash = (a: string, b: string): boolean => bareHash(a) === bareHash(b)

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
      // Implements the contract documented on `BadgeVerifier.context`.
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
      // Implements the contract documented on `BadgeVerifier.verify`.
      throw new Error('world verifier: verify() called while unconfigured')
    }
    // Everything checkable from the payload alone is checked here, before the
    // portal is called at all: a proof bound to another Right, or of another
    // protocol family or credential, is refused without spending a round trip.
    const parsedPayload = v.safeParse(ProofPayload, input.payload)
    if (!parsedPayload.success) {
      return { error: 'bad_input' }
    }
    const { responses } = parsedPayload.output
    const [first] = responses
    if (first === undefined) {
      return { error: 'bad_input' }
    }
    // Every response item must be bound to this Right, not just one: the
    // shipped preset returns exactly one item, so "every" and "at least one"
    // coincide today, and requiring every item keeps the binding complete if a
    // multi-credential preset is ever used. An item bound elsewhere would be a
    // proof someone else's page could have obtained.
    const expectedHash = hashSignal(input.uid)
    if (!responses.every((response) => sameHash(response.signal_hash, expectedHash))) {
      return { error: 'bad_input' }
    }
    if (parsedPayload.output.protocol_version !== PROTOCOL_VERSION) {
      return { error: 'bad_proof' }
    }
    if (parsedPayload.output.environment !== WORLD_ENVIRONMENT) {
      return { error: 'bad_proof' }
    }
    if (!responses.every((response) => HUMAN_IDENTIFIERS.has(response.identifier))) {
      return { error: 'bad_proof' }
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
      // The credential the proof actually carries, not an assumption about it.
      // Every item was checked against HUMAN_IDENTIFIERS above, so the first
      // one names the credential the whole payload attests.
      credential: first.identifier,
      expiresAt: null,
      // A nullifier is scoped to (app_id, action), so the stored scope must be
      // too. With the action alone, re-registering the app under an unchanged
      // action would hand the same person a fresh nullifier inside an unchanged
      // scope, and the unique index would stop catching them: one human, two
      // badged passes. This is not retrofittable once rows exist.
      scope: `${config.appId}:${config.action}`,
      subjectKey: parsed.output.nullifier.toLowerCase(),
    } satisfies VerifiedSubject
  },
}
