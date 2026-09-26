import { afterEach, describe, expect, it, vi } from 'vitest'

import { worldVerifier } from '../src/badges/providers/world.ts'
import { verifierFor } from '../src/badges/verifier.ts'
import type { Bindings } from '../src/env.ts'

const UID = `0x${'a1'.repeat(32)}` as const
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
    const out = await worldVerifier.verify(configured, { payload: { signal: UID }, uid: UID })
    expect(out).toStrictEqual({
      credential: 'orb',
      expiresAt: null,
      scope: 'ethtokyo2026-human',
      subjectKey: '0xdead',
    })
  })

  it('rejects a proof whose signal is not the requested right', async () => {
    const other = `0x${'b2'.repeat(32)}`
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ nullifier: '0xdead', success: true })),
    )
    await expect(
      worldVerifier.verify(configured, { payload: { signal: other }, uid: UID }),
    ).resolves.toStrictEqual({
      error: 'bad_input',
    })
  })

  it('rejects when the portal refuses the proof', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ code: 'invalid_proof' }, { status: 400 })),
    )
    await expect(
      worldVerifier.verify(configured, { payload: { signal: UID }, uid: UID }),
    ).resolves.toStrictEqual({
      error: 'bad_proof',
    })
  })
})
