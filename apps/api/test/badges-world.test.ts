import { afterEach, describe, expect, it, vi } from 'vitest'

import { worldVerifier } from '../src/badges/providers/world.ts'
import { verifierFor } from '../src/badges/verifier.ts'
import type { Bindings } from '../src/env.ts'
import { WORLD_ACTION, worldProof as proofFor, worldSessionProof } from './fixtures.ts'

const UID = `0x${'a1'.repeat(32)}` as const

// The canonical form of the `0xdead` the stubbed portal returns: lowercase,
// 0x-prefixed, zero-padded to 64 hex digits, so two spellings of one field
// element cannot be stored as two different people.
const DEAD = `0x${'0'.repeat(60)}dead`

const configured = {
  WORLD_ACTION,
  WORLD_APP_ID: 'app_test',
  WORLD_RP_ID: 'rp_test',
  WORLD_RP_SIGNING_KEY: `0x${'11'.repeat(32)}`,
} as unknown as Bindings

describe('world verifier', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is the verifier for the human kind', () => {
    expect(verifierFor('human')?.name).toBe('world')
    expect(verifierFor('nonsense')).toBeNull()
  })

  it('is configured when all four bindings are set', () => {
    expect(worldVerifier.configured(configured)).toBe(true)
  })

  // Both falsy forms — an empty string and an absent binding — must gate the
  // same way, for every one of the four names: the feature is all-or-nothing.
  it.each([
    ['WORLD_APP_ID', ''],
    ['WORLD_APP_ID', undefined],
    ['WORLD_RP_ID', ''],
    ['WORLD_RP_ID', undefined],
    ['WORLD_ACTION', ''],
    ['WORLD_ACTION', undefined],
    ['WORLD_RP_SIGNING_KEY', ''],
    ['WORLD_RP_SIGNING_KEY', undefined],
  ] as const)('is unconfigured when %s is %j', (name, value) => {
    expect(worldVerifier.configured({ ...configured, [name]: value })).toBe(false)
  })

  it('returns the subject key when the portal accepts the proof', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ nullifier: '0xDEAD', success: true })),
    )
    const out = await worldVerifier.verify(configured, { payload: proofFor(UID), uid: UID })
    expect(out).toStrictEqual({
      // Read from the pinned issuer schema id, not copied from the payload's
      // `identifier` string.
      credential: 'proof_of_human',
      expiresAt: null,
      // A 4.0 nullifier's real uniqueness domain: rp id and action together,
      // not the app id a 3.0 external nullifier is built from.
      scope: `rp_test:${WORLD_ACTION}`,
      subjectKey: DEAD,
    })
  })

  // The unique index is a string comparison, so the same field element written
  // two ways would be two people. Every spelling the portal could answer with
  // has to land on one row.
  it.each(['0xdead', '0xDEAD', 'dead', `0x${'0'.repeat(60)}DEAD`])(
    'canonicalises the nullifier %s to one padded lowercase form',
    async (nullifier) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Response.json({ nullifier, success: true })),
      )
      await expect(
        worldVerifier.verify(configured, { payload: proofFor(UID), uid: UID }),
      ).resolves.toMatchObject({ subjectKey: DEAD })
    },
  )

  it.each(['', '0x', 'nope', `0x${'a'.repeat(65)}`])(
    'refuses a nullifier that is not hex inside 256 bits (%j) rather than padding it',
    async (nullifier) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Response.json({ nullifier, success: true })),
      )
      await expect(
        worldVerifier.verify(configured, { payload: proofFor(UID), uid: UID }),
      ).resolves.toStrictEqual({ error: 'bad_proof' })
    },
  )

  // Every rejection is decided from the payload alone, so a portal stubbed to
  // say yes is never even called. The credential rows are the other half of the
  // accepted-set rule: only a credential in `HUMAN_CREDENTIALS` is a verified
  // human, and the family check above closes the second nullifier family.
  // Passport is refused deliberately and not for want of a mapping — it is the
  // next entry that could be added, and until it is asked for it is not one.
  it.each([
    ['a proof bound to a different right', proofFor(`0x${'b2'.repeat(32)}`), 'bad_input'],
    ['a proof carrying a signal hash of nothing', proofFor(UID, { signalHash: '0x00' }), 'bad_input'],
    ['a payload that is not shaped like a proof', { signal: UID }, 'bad_input'],
    ['a payload with no responses at all', { ...proofFor(UID), responses: [] }, 'bad_input'],
    // A session proof is well-formed and says nothing about uniqueness: its
    // nullifier is bound to a randomised action. It must be refused as a proof
    // of the wrong kind, not merely tripped up by a missing field.
    ['a session proof', worldSessionProof(UID), 'bad_proof'],
    // `session_id` is read as an optional unknown, so a null one is still
    // *present*: the refusal is an explicit `!== undefined`, not a truthiness
    // test that a null would slip through.
    ['a uniqueness proof carrying a null session id', { ...proofFor(UID), session_id: null }, 'bad_proof'],
    ['a proof from the other protocol family', proofFor(UID, { protocolVersion: '3.0' }), 'bad_proof'],
    ['a staging proof', proofFor(UID, { environment: 'staging' }), 'bad_proof'],
    ['a sandbox proof', proofFor(UID, { environment: 'sandbox' }), 'bad_proof'],
    // The action is half of the nullifier's uniqueness domain, so a proof made
    // for another action carries a key from another domain.
    ['a proof made for another action', proofFor(UID, { action: 'other-action' }), 'bad_proof'],
    ['a proof made for no action', proofFor(UID, { action: '' }), 'bad_proof'],
    // Credentials are pinned by issuer schema id, so each of these carries the
    // real number for the credential it names rather than a mismatched pair.
    ['a selfie credential', proofFor(UID, { identifier: 'selfie', issuerSchemaId: 11 }), 'bad_proof'],
    ['a passport credential', proofFor(UID, { identifier: 'passport', issuerSchemaId: 9303 }), 'bad_proof'],
    // 128 is the portal's own "faux issuer", freely mintable from the simulator
    // and accepted only in staging or sandbox: the credential that would make
    // the one-human-one-pass claim meaningless.
    ['the staging faux issuer', proofFor(UID, { issuerSchemaId: 128 }), 'bad_proof'],
    ['an unknown credential', proofFor(UID, { issuerSchemaId: 0 }), 'bad_proof'],
  ])('rejects %s, without calling the portal', async (_name, payload, error) => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    await expect(worldVerifier.verify(configured, { payload, uid: UID })).resolves.toStrictEqual({
      error,
    })
    expect(portal).not.toHaveBeenCalled()
  })

  // The pin is the number, not the spelling beside it: World App has reported
  // the same credential as `orb` and as `proof_of_human` depending on transport,
  // and a payload may carry either without meaning a different credential.
  it.each(['proof_of_human', 'orb'])(
    'accepts the human credential whatever %s spelling rides beside its schema id',
    async (identifier) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Response.json({ nullifier: '0xdead', success: true })),
      )
      await expect(
        worldVerifier.verify(configured, { payload: proofFor(UID, { identifier }), uid: UID }),
      ).resolves.toMatchObject({ credential: 'proof_of_human' })
    },
  )

  // The two directions of the conditional signal binding, and the reason it is
  // conditional at all: a 4.0 response item omits `signal_hash` when idkit has
  // no cached hash to reattach (its 4.0 branch has no legacy fallback, unlike
  // its 3.0 one), and the portal defaults the field, so absence is inside the
  // contract. A hash that is present is still binding — the pair below is what
  // keeps that from silently becoming "any hash will do".
  it('accepts a 4.0 item that carries no signal hash, and calls the portal', async () => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    await expect(
      worldVerifier.verify(configured, { payload: proofFor(UID, { signalHash: null }), uid: UID }),
    ).resolves.toMatchObject({ subjectKey: DEAD })
    expect(portal).toHaveBeenCalledOnce()
  })

  it('rejects a 4.0 item whose signal hash is present and binds another right', async () => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    await expect(
      worldVerifier.verify(configured, { payload: proofFor(`0x${'b2'.repeat(32)}`), uid: UID }),
    ).resolves.toStrictEqual({ error: 'bad_input' })
    expect(portal).not.toHaveBeenCalled()
  })

  // The two accepted credentials, and the reason there are two: the event is in
  // Japan, where many attendees hold My Number Card and have never been to an
  // Orb. The stored `credential` is derived from the proof's own
  // `issuer_schema_id`, so the row records which one was actually used rather
  // than a constant — that is what keeps it auditable.
  it.each([
    ['proof_of_human', 1, 'proof_of_human'],
    ['mnc', 9310, 'mnc'],
  ] as const)(
    'accepts the %s credential and records it as the credential used',
    async (identifier, issuerSchemaId, credential) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Response.json({ nullifier: '0xdead', success: true })),
      )
      await expect(
        worldVerifier.verify(configured, {
          payload: proofFor(UID, { identifier, issuerSchemaId }),
          uid: UID,
        }),
      ).resolves.toStrictEqual({
        credential,
        expiresAt: null,
        scope: `rp_test:${WORLD_ACTION}`,
        subjectKey: DEAD,
      })
    },
  )

  // The guard that keeps two accepted credentials from becoming two subject
  // keys. A request that accepts either credential can be answered with both at
  // once, and the nullifier is credential-independent by derivation — so equal
  // nullifiers are what a genuine two-credential answer looks like. Differing
  // ones would mean one person holds several subject keys for one (rp, action),
  // which the unique index cannot detect because only one of them is ever
  // written: the index stays satisfied and one human badges two passes. So the
  // proof is refused and nothing is written, and the portal is not even called.
  it('refuses a multi-credential proof whose items carry different nullifiers, without writing or calling the portal', async () => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    const payload = proofFor(UID, {
      items: [
        { identifier: 'proof_of_human', issuerSchemaId: 1, nullifier: '0xdead' },
        { identifier: 'mnc', issuerSchemaId: 9310, nullifier: '0xbeef' },
      ],
    })
    await expect(worldVerifier.verify(configured, { payload, uid: UID })).resolves.toStrictEqual({
      error: 'bad_proof',
    })
    expect(portal).not.toHaveBeenCalled()
  })

  it('accepts a multi-credential proof whose items agree, and records the first credential', async () => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    const payload = proofFor(UID, {
      items: [
        { identifier: 'proof_of_human', issuerSchemaId: 1, nullifier: '0xdead' },
        { identifier: 'mnc', issuerSchemaId: 9310, nullifier: '0xdead' },
      ],
    })
    await expect(worldVerifier.verify(configured, { payload, uid: UID })).resolves.toMatchObject({
      credential: 'proof_of_human',
      subjectKey: DEAD,
    })
    expect(portal).toHaveBeenCalledOnce()
  })

  // Equality is decided on the canonical form, for the same reason the stored
  // key is: two spellings of one field element are one person, not two.
  it('treats two spellings of one nullifier across items as the same person', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ nullifier: '0xdead', success: true })),
    )
    const payload = proofFor(UID, {
      items: [
        { identifier: 'proof_of_human', issuerSchemaId: 1, nullifier: '0xDEAD' },
        { identifier: 'mnc', issuerSchemaId: 9310, nullifier: `0x${'0'.repeat(60)}dead` },
      ],
    })
    await expect(worldVerifier.verify(configured, { payload, uid: UID })).resolves.toMatchObject({
      subjectKey: DEAD,
    })
  })

  // A value that is not a nullifier cannot be shown equal to anything, so it is
  // refused with the rest rather than compared as a string.
  it('refuses a multi-credential proof carrying an item nullifier that is not one', async () => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    const payload = proofFor(UID, {
      items: [
        { identifier: 'proof_of_human', issuerSchemaId: 1, nullifier: 'nope' },
        { identifier: 'mnc', issuerSchemaId: 9310, nullifier: 'nope' },
      ],
    })
    await expect(worldVerifier.verify(configured, { payload, uid: UID })).resolves.toStrictEqual({
      error: 'bad_proof',
    })
    expect(portal).not.toHaveBeenCalled()
  })

  // One accepted and one refused credential in the same payload is still a
  // refusal: the accepted set is checked over every item, not over the first.
  it('refuses a multi-credential proof where one item is a credential this deployment does not accept', async () => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    const payload = proofFor(UID, {
      items: [
        { identifier: 'proof_of_human', issuerSchemaId: 1, nullifier: '0xdead' },
        { identifier: 'passport', issuerSchemaId: 9303, nullifier: '0xdead' },
      ],
    })
    await expect(worldVerifier.verify(configured, { payload, uid: UID })).resolves.toStrictEqual({
      error: 'bad_proof',
    })
    expect(portal).not.toHaveBeenCalled()
  })

  it('rejects when the portal refuses the proof', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ code: 'invalid_proof', success: false }, { status: 400 })),
    )
    await expect(
      worldVerifier.verify(configured, { payload: proofFor(UID), uid: UID }),
    ).resolves.toStrictEqual({
      error: 'bad_proof',
    })
  })

  // The portal answers 200 to things it has not verified — a re-presented
  // nullifier among them — and every failure carries `success: false`. A 2xx
  // alone is therefore not the contract, and a body without `success: true`
  // must not become a badge.
  it.each([
    ['success is false', { code: 'all_verifications_failed', success: false }],
    ['success is missing', { nullifier: '0xdead' }],
    ['the nullifier is missing', { success: true }],
  ])('rejects a 200 whose body says %s', async (_name, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json(body)),
    )
    await expect(
      worldVerifier.verify(configured, { payload: proofFor(UID), uid: UID }),
    ).resolves.toStrictEqual({ error: 'bad_proof' })
  })
})
