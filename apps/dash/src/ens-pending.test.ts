// @vitest-environment happy-dom
import type { EnsClaimView, Hex } from '@fuda/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { readPendingEnsClaim, reconcilePendingEnsClaim, writePendingEnsClaim } from './ens-pending.ts'

const NAME = 'coffee.fuda.eth'
const TX: Hex = `0x${'ab'.repeat(32)}`
const ens: EnsClaimView = { claimTxHash: null, expiry: null, name: NAME, status: 'unclaimed' }

describe('pending ENS storage', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('retains a bundle across readers and isolates issuers', () => {
    writePendingEnsClaim('issuer-a', { bundleId: 'bundle-1', name: NAME })
    expect(readPendingEnsClaim('issuer-a')).toStrictEqual({ bundleId: 'bundle-1', name: NAME })
    expect(readPendingEnsClaim('issuer-b')).toBeNull()
    expect(reconcilePendingEnsClaim('issuer-a', ens)).toStrictEqual({ bundleId: 'bundle-1', name: NAME })
  })

  it('retains work while ENS is unavailable', () => {
    const pending = { bundleId: 'bundle-1', name: NAME }
    writePendingEnsClaim('issuer-a', pending)
    expect(reconcilePendingEnsClaim('issuer-a', null)).toBeNull()
    expect(readPendingEnsClaim('issuer-a')).toStrictEqual(pending)
  })

  it('replaces a bundle with its receipt and removes confirmed work', () => {
    writePendingEnsClaim('issuer-a', { bundleId: 'bundle-1', name: NAME })
    writePendingEnsClaim('issuer-a', { name: NAME, txHash: TX })
    expect(readPendingEnsClaim('issuer-a')).toStrictEqual({ name: NAME, txHash: TX })
    expect(reconcilePendingEnsClaim('issuer-a', { ...ens, claimTxHash: TX, status: 'claimed' })).toBeNull()
    expect(readPendingEnsClaim('issuer-a')).toBeNull()
  })

  it('discards superseded names and explicit failures', () => {
    writePendingEnsClaim('issuer-a', { name: NAME, txHash: TX })
    expect(reconcilePendingEnsClaim('issuer-a', { ...ens, name: 'other.fuda.eth' })).toBeNull()
    writePendingEnsClaim('issuer-a', { bundleId: 'bundle-1', name: NAME })
    writePendingEnsClaim('issuer-a', null)
    expect(readPendingEnsClaim('issuer-a')).toBeNull()
  })
})
