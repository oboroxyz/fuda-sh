import { afterEach, describe, expect, it, vi } from 'vitest'

import { worldVerifier } from '../src/badges/providers/world.ts'
import { verifierFor } from '../src/badges/verifier.ts'
import type { Bindings } from '../src/env.ts'
import { worldProof as proofFor } from './fixtures.ts'

const UID = `0x${'a1'.repeat(32)}` as const

// The shipped payload with the signal binding removed entirely: the field is
// optional in the vendor's type, and a proof carrying no binding must not pass.
const unboundProof = () => ({
  environment: 'production',
  nonce: '0x01',
  protocol_version: '3.0',
  responses: [{ identifier: 'orb', merkle_root: '0xroot', nullifier: '0xdead', proof: '0xproof' }],
})

const configured = {
  WORLD_ACTION: 'ethtokyo2026-human',
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
      credential: 'orb',
      expiresAt: null,
      // The nullifier's real uniqueness domain: app id and action together.
      scope: 'app_test:ethtokyo2026-human',
      subjectKey: '0xdead',
    })
  })

  // Every rejection is decided from the payload alone, so a portal stubbed to
  // say yes is never even called. The credential rows are the other half of the
  // one-preset rule: only the human credential is a verified human, and the
  // family check above closes the second nullifier family.
  it.each([
    ['a proof bound to a different right', proofFor(`0x${'b2'.repeat(32)}`), 'bad_input'],
    ['a proof that binds no signal at all', unboundProof(), 'bad_input'],
    ['a payload that is not shaped like a proof', { signal: UID }, 'bad_input'],
    ['a proof from the other protocol family', proofFor(UID, { protocolVersion: '4.0' }), 'bad_proof'],
    ['a selfie credential', proofFor(UID, { identifier: 'selfie' }), 'bad_proof'],
    ['a device credential', proofFor(UID, { identifier: 'device' }), 'bad_proof'],
    ['a passport credential', proofFor(UID, { identifier: 'passport' }), 'bad_proof'],
    ['an mnc credential', proofFor(UID, { identifier: 'mnc' }), 'bad_proof'],
    ['a document credential', proofFor(UID, { identifier: 'document' }), 'bad_proof'],
  ])('rejects %s, without calling the portal', async (_name, payload, error) => {
    const portal = vi.fn<() => Response>(() => Response.json({ nullifier: '0xdead', success: true }))
    vi.stubGlobal('fetch', portal)
    await expect(worldVerifier.verify(configured, { payload, uid: UID })).resolves.toStrictEqual({
      error,
    })
    expect(portal).not.toHaveBeenCalled()
  })

  it('accepts either spelling of the human credential and records the one it saw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ nullifier: '0xdead', success: true })),
    )
    await expect(
      worldVerifier.verify(configured, {
        payload: proofFor(UID, { identifier: 'proof_of_human' }),
        uid: UID,
      }),
    ).resolves.toMatchObject({ credential: 'proof_of_human' })
  })

  it('rejects when the portal refuses the proof', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ code: 'invalid_proof' }, { status: 400 })),
    )
    await expect(
      worldVerifier.verify(configured, { payload: proofFor(UID), uid: UID }),
    ).resolves.toStrictEqual({
      error: 'bad_proof',
    })
  })
})
