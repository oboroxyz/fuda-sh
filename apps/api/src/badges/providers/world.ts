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
// The payload is read in two stages on purpose. This first one is the envelope:
// only what decides whether the payload is a proof of the kind this deployment
// accepts at all, so each of those refusals is a deliberate one rather than a
// side effect of a field a rejected shape happens to lack.
//
// `session_id` is read here for that reason. The vendor's own discriminator is
// "Check `session_id` to determine if this is a session proof: session_id !==
// undefined → session proof; session_id === undefined → uniqueness proof", and a
// session proof is a well-formed proof of the wrong kind: its nullifier is
// bound to a *randomised* action and "does NOT guarantee uniqueness of a World
// ID" (docs/research/world-id-2026-09-26.md Q3). Accepting one would silently
// destroy the guarantee this badge exists to make, so absence is required —
// `v.unknown()` rather than `v.string()` so that a null or a number is
// "present" too, not a value that slips past a type check.
const ProofEnvelope = v.looseObject({
  environment: v.string(),
  protocol_version: v.string(),
  session_id: v.optional(v.unknown()),
})

// Stage two: the uniqueness proof itself. `action` is a required field on
// `IDKitResultV4` ("Action identifier (required for uniqueness proofs)"),
// unlike 3.0 where it was optional — which is what makes the action check in
// `verify()` possible at all.
//
// `signal_hash` stays optional here, and `verify()` explains why at the point
// where it is compared. `identifier` is not read: the credential is pinned on
// the numeric `issuer_schema_id` below instead.
const UniquenessProof = v.looseObject({
  action: v.string(),
  responses: v.array(
    v.looseObject({
      issuer_schema_id: v.number(),
      nullifier: v.string(),
      signal_hash: v.optional(v.string()),
    }),
  ),
})

// The one protocol family this deployment accepts, and the server-side half of
// the choice made once in apps/app/src/badges.ts (`humanConstraints`). The
// client asks for the 4.0 credentials with `allow_legacy_proofs: false`, so 4.0
// is the family and 4.0 alone. Accepting 3.0 as well would let one person obtain a
// second, unrelated nullifier for the same action and badge a second pass — the
// vendor says as much on `allow_legacy_proofs` ("you must track both v3 and v4
// nullifiers to prevent double-claims"). The client preset and this constant
// change together or not at all.
const PROTOCOL_VERSION = '4.0'

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
// `WORLD_ENVIRONMENT` in apps/app/src/badges.ts. The portal now agrees from its
// side too: since 2026-09-25 its production verify endpoint answers 403
// `environment_not_allowed` to a staging or sandbox proof unless the app has
// opened a 24-hour staging window and sends the token it issued
// (docs/research/world-id-2026-09-26.md Q1). This check is the half that does
// not depend on that deployment having shipped.
const WORLD_ENVIRONMENT = 'production'

// Which credentials count as "one verified human", and what a badge row records
// for each. Pinned on the number rather than on the `identifier` string beside
// it: `ResponseItemV4.issuer_schema_id` is documented as "1=proof_of_human,
// 9303=passport, 9310=mnc" and `SelfieCheckResponseItemV4` fixes it at 11, so
// the number *is* the credential's identity, while `identifier` is a
// spelling this adapter cannot pin — World App reported the Orb credential as
// both `orb` and `proof_of_human` depending on transport. A number cannot be
// spelled two ways.
//
// Two entries, not one. The event this ships for is in Japan, where many
// attendees hold the My Number Card credential (9310) and have never been to an
// Orb, and refusing them would fail the demo for exactly the people it is for.
// Accepting both is safe because the nullifier does not depend on which
// credential produced it — see the equal-nullifier guard in `verify()` for the
// derivation and the sources. Adding passport (9303) later is one line here;
// selfie (11) is a weaker claim and stays out, and so does 128, the portal's own
// "faux issuer", which it accepts for `proof_of_human` in staging or sandbox
// only and whose credentials are "freely mintable from the simulator"
// (docs/research/world-id-2026-09-26.md Q1) — a credential that would make the
// one-human-one-pass claim meaningless.
//
// The map is also where the stored `credential` comes from, so the row records
// which credential was actually used rather than a constant: the label is
// derived from the proof's own `issuer_schema_id` and never from client-supplied
// text. `credential` is not part of `BadgeView`, so this changes nothing a
// client can see — it is there so a row stays truthful and auditable.
const HUMAN_CREDENTIALS: ReadonlyMap<number, string> = new Map([
  [1, 'proof_of_human'],
  [9310, 'mnc'],
])

// Both sides of the comparison in one form, so a 0x prefix or an upper-cased
// digit cannot read as a different signal. `hashSignal` returns 0x-prefixed
// lowercase hex, padded to 32 bytes, on both the JS and the wasm side; this
// only guards the payload half, which arrives from a client.
const bareHash = (hash: string): string => hash.replace(/^0x/iu, '').toLowerCase()

const sameHash = (a: string, b: string): boolean => bareHash(a) === bareHash(b)

// The two fields of the portal's verify response this adapter reads, both now
// confirmed against the endpoint's own implementation and the published OpenAPI
// schema (docs/research/world-id-2026-09-26.md Q5): the field is `nullifier`,
// and success is HTTP 200 *plus* `success: true`, while every failure carries
// `success: false` with a `code` and a `detail`. `success` is therefore what is
// required here — an HTTP status alone is not the contract.
const VerifyResponse = v.looseObject({
  nullifier: v.pipe(v.string(), v.minLength(1)),
  success: v.literal(true),
})

// The unique index over (verifier, scope, subject_key) is a string comparison,
// so it is only as good as the form written into it. A nullifier is a 256-bit
// integer rendered as hex, and "different strings may represent the same field
// element, which could result in a compromise of uniqueness" — the protocol's
// own type says so and recommends storing the number
// (docs/research/world-id-2026-09-26.md Q5). D1 has no 78-digit numeric, so one
// canonical string stands in for it: lowercase, `0x`-prefixed, zero-padded to
// 64 hex digits, so `0xdead` and `0x00…dead` cannot both be written as two
// different people. Anything that is not hex inside 256 bits is not a nullifier
// and is refused rather than padded into one.
const NULLIFIER_HEX = /^[\da-f]{1,64}$/u

const canonicalNullifier = (value: string): string | null => {
  const bare = value.replace(/^0x/iu, '').toLowerCase()
  return NULLIFIER_HEX.test(bare) ? `0x${bare.padStart(64, '0')}` : null
}

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
    // portal is called at all: a session proof, or a proof of another protocol
    // family, environment, action or credential, or one bound to another Right,
    // is refused without spending a round trip.
    const envelope = v.safeParse(ProofEnvelope, input.payload)
    if (!envelope.success) {
      return { error: 'bad_input' }
    }
    // A session proof, refused deliberately and first: see `ProofEnvelope`.
    if (envelope.output.session_id !== undefined) {
      return { error: 'bad_proof' }
    }
    if (envelope.output.protocol_version !== PROTOCOL_VERSION) {
      return { error: 'bad_proof' }
    }
    if (envelope.output.environment !== WORLD_ENVIRONMENT) {
      return { error: 'bad_proof' }
    }
    const parsedProof = v.safeParse(UniquenessProof, input.payload)
    if (!parsedProof.success) {
      return { error: 'bad_input' }
    }
    const { action, responses } = parsedProof.output
    if (responses.length === 0) {
      return { error: 'bad_input' }
    }
    // The proof was made for *this* deployment's action, not another one. 4.0
    // makes this checkable for the first time — `action` is optional on a 3.0
    // result and required on a 4.0 uniqueness proof — and it is worth checking:
    // the action is half of the nullifier's uniqueness domain, so a proof
    // carrying a different action carries a nullifier from a different domain
    // than the scope this adapter is about to store.
    if (action !== config.action) {
      return { error: 'bad_proof' }
    }
    // One pass over the items: every credential must be one this deployment
    // accepts, and the label the badge row records comes from the same lookup
    // rather than from a constant or from the payload's `identifier` text.
    const credentials = responses.map((response) => HUMAN_CREDENTIALS.get(response.issuer_schema_id))
    const credential = credentials.at(0)
    if (credential === undefined || credentials.includes(undefined)) {
      return { error: 'bad_proof' }
    }
    // More than one item means World App satisfied the request with more than
    // one credential at once, and every one of them must name the same person.
    // It should: the nullifier does not depend on which credential produced it.
    // It is `Poseidon2(DS_N, query, oprf_response)` where `query =
    // oprf_query_digest(leaf_index, action, scope)` — the authenticator's merkle
    // leaf index, the action, and the rp id — and `issuer_schema_id` enters a
    // *different* OPRF module (`CredentialBlindingFactor`), never this one
    // (world-id-protocol `crates/proof/src/oprf_query.rs` and
    // `circom/client_side_proofs/oprf_nullifier.circom`; the type's own doc
    // comment says "derived from (user, rpId, action)",
    // docs/research/world-id-2026-09-26.md Q3). So identical nullifiers are what
    // a genuine two-credential answer looks like.
    //
    // That reading is load-bearing and has not been measured on a device, so it
    // is checked rather than assumed. If the values differ, one person holds
    // several subject keys for one (rp, action) — precisely the condition
    // UNIQUE (verifier, scope, subject_key) cannot detect, because only one of
    // those keys is ever written, so the index stays satisfied, every test stays
    // green, and one human quietly badges two passes. Failing closed here costs
    // that person a badge; failing open costs the guarantee the badge exists to
    // make. So the proof is refused and no row is written.
    //
    // Compared in canonical form, because `0xDEAD` and `0xdead` are one field
    // element and not two people; a value that is not a nullifier at all cannot
    // be shown equal to anything and is refused with the rest.
    if (responses.length > 1) {
      const keys = new Set(responses.map((response) => canonicalNullifier(response.nullifier)))
      if (keys.size !== 1 || keys.has(null)) {
        return { error: 'bad_proof' }
      }
    }
    // The signal binding, and the one place this adapter is deliberately looser
    // than its 3.0 predecessor: a hash that is present must match, and a hash
    // that is absent is not on its own treated as a forgery.
    //
    // What closes the replay this field exists to stop is not the comparison
    // below — it is the proof itself. 4.0 feeds `signal_hash` into the Verifier
    // contract as a circuit public input (`signalHash: BigInt(item.signal_hash)`
    // in the portal's verify-v4), and the portal's request schema defaults an
    // absent one to `0x0`. Strip the field off a proof bound to Right A and the
    // public input becomes 0, on-chain verification fails, and that item comes
    // back failed — so the field cannot be deleted to escape this check, nor
    // swapped for the hash of another uid (docs/research/world-id-2026-09-26.md
    // Q6). The comparison below is therefore a pre-flight: it refuses a
    // mismatched hash before a round trip is spent, and reports it as
    // `bad_input` rather than waiting for the portal's `bad_proof`.
    //
    // Absence is legitimate, so failing closed on it is stricter than the
    // contract. `ResponseItemV4.signal_hash` is `Option` plus
    // `skip_serializing_if` in the Rust source of truth — genuinely omitted
    // from the JSON, not sent empty — and the portal supplies the default
    // above. idkit can produce such an item: the bridge returns no signal
    // hashes, so idkit reattaches them from the request, and its 4.0 lookup is
    // `signal_hashes.get(normalized).or_else(get(incoming)).cloned()`, an
    // `Option` with no fallback, where its 3.0 branch ends in
    // `unwrap_or_else(|| cached_signal_hashes.legacy())` and therefore always
    // has one (worldcoin/idkit, rust/core/src/bridge.rs).
    //
    // How far that looseness is load-bearing on *this* path is not yet
    // measured, and the honest reading is narrower than "a valid proof would be
    // rejected". This path always requests a signal;
    // `CachedSignalHashes::compute` keys the map on each requested credential
    // type, so the two-credential request carries a hash for `proof_of_human`
    // and one for `mnc`; and `normalize_response_identifier` rewrites only
    // `face` → `selfie`. So an accepted item reaches this line without a hash
    // only if World App echoes the identifier under some other spelling —
    // `orb`, the one HUMAN_CREDENTIALS above records having seen, being the
    // candidate.
    // Whether a real proof carries the hash is the open question the device
    // test settles; until it is taken, accepting absence is the choice that
    // does not rest the demo on a spelling nobody here has measured.
    //
    // What accepting absence gives up: a proof minted against this deployment's
    // public context with no signal at all can be pointed at any
    // ADMIT-eligible uid, and this adapter cannot tell that the human who
    // verified meant that Right. What still holds the line:
    //   - `action` is checked above, so a proof obtained for another action or
    //     another relying party is refused outright;
    //   - the Right must exist and be ADMIT-eligible (routes/badges.ts), so an
    //     arbitrary uid is not a target;
    //   - one nullifier badges one Right, ever, inside (verifier, scope) — the
    //     unique index — and 4.0 refuses a second uniqueness proof of the same
    //     action (`nullifier_replayed`), so nobody holds spare proofs to spray.
    // The countable claim therefore survives an unbound proof: spending one on
    // someone else's Right consumes the only one that person has, so the number
    // of humans and the number of badged passes still move together. What an
    // unbound proof can cost is attribution, not the count — and that cost is
    // not newly introduced here: a uid is a bearer value, this route never
    // proves the caller holds the Right, and a hostile client picks its own
    // signal, so a present-and-matching hash never defended against a requester
    // who chose someone else's uid up front.
    const expectedHash = hashSignal(input.uid)
    const bound = (signalHash: string | undefined): boolean =>
      signalHash === undefined || sameHash(signalHash, expectedHash)
    if (!responses.every((response) => bound(response.signal_hash))) {
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
    // `success: true` is required by this parse, not merely a 2xx: the portal
    // answers 200 to a re-presented nullifier and does not dedupe for anyone,
    // so fuda's own unique index is the only thing enforcing one badge per
    // person (docs/research/world-id-2026-09-26.md Q5).
    const parsed = v.safeParse(VerifyResponse, body)
    if (!parsed.success) {
      return { error: 'bad_proof' }
    }
    const subjectKey = canonicalNullifier(parsed.output.nullifier)
    if (subjectKey === null) {
      return { error: 'bad_proof' }
    }
    return {
      // Which credential this person actually used, read from the proof's own
      // `issuer_schema_id`. With every item's nullifier proven equal above, the
      // first item's label describes the same person as any other item's.
      credential,
      expiresAt: null,
      // A 4.0 nullifier is RP-scoped — "derived from (user, rpId, action)", and
      // the vendor's own response type calls it an "RP-scoped nullifier" — so
      // the stored scope is the rp id and the action, which is the domain the
      // key is actually unique within (docs/research/world-id-2026-09-26.md Q3).
      // Deliberately not the app id: that is what a 3.0 Semaphore external
      // nullifier is built from, and recording the wrong one would mean the
      // stored scope does not describe the domain the key is unique in. The
      // `rp_` prefix carried in the value also records which family's domain a
      // row was written under, so a 3.0-scoped `app_…` row and a 4.0-scoped
      // `rp_…` row can never collide or be mistaken for one another. With the
      // action alone, re-registering under an unchanged action would hand the
      // same person a fresh nullifier inside an unchanged scope, and the unique
      // index would stop catching them: one human, two badged passes. This is
      // not retrofittable once rows exist.
      scope: `${config.rpId}:${config.action}`,
      subjectKey,
    } satisfies VerifiedSubject
  },
}
