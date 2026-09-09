import type { EnsClaimView, Hex } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import type { Result } from './api.ts'
import { claimIsBusy, initialClaimState, reconcileClaimState, runClaim } from './ens-claim.ts'
import type { ClaimIo, ClaimState, ClaimVoucher, ClaimVoucherResponse } from './ens-claim.ts'

const TX: Hex = `0x${'ab'.repeat(32)}`
const NAME = 'wassie-coffee.fuda.eth'

const VOUCHER: ClaimVoucher = {
  deadline: 2000,
  expiry: 3000,
  issuer: `0x${'11'.repeat(20)}`,
  label: 'wassie-coffee',
  nonce: '0',
  registrar: `0x${'22'.repeat(20)}`,
  signature: `0x${'33'.repeat(65)}`,
}

const ok = <T>(body: T): Result<T> => ({ body, ok: true })
const fail = (error: string): Result<never> => ({ error, network: false, ok: false, status: 500 })

const io = (overrides: Partial<ClaimIo> = {}): ClaimIo => ({
  confirmClaim: async () =>
    await Promise.resolve(ok<EnsClaimView>({ claimTxHash: TX, expiry: 3000, name: NAME, status: 'claimed' })),
  requestVoucher: async () =>
    await Promise.resolve(ok<ClaimVoucherResponse>({ chainId: 11_155_111, name: NAME, voucher: VOUCHER })),
  submitClaim: async () => await Promise.resolve(TX),
  ...overrides,
})

const run = async (overrides: Partial<ClaimIo> = {}) => {
  const seen: ClaimState[] = []
  const final = await runClaim(io(overrides), (state) => {
    seen.push(state)
  })
  return { final, seen }
}

describe(initialClaimState, () => {
  it('starts claimed only when the chain has confirmed it', () => {
    const claimed: EnsClaimView = { claimTxHash: TX, expiry: 3000, name: NAME, status: 'claimed' }
    const pending: EnsClaimView = { claimTxHash: null, expiry: null, name: NAME, status: 'unclaimed' }

    expect(initialClaimState(claimed)).toStrictEqual({ claimTxHash: TX, kind: 'claimed', name: NAME })
    expect(initialClaimState(pending).kind).toBe('unclaimed')
    expect(initialClaimState(null).kind).toBe('unclaimed')
  })
})

describe(reconcileClaimState, () => {
  const unclaimed: EnsClaimView = { claimTxHash: null, expiry: null, name: NAME, status: 'unclaimed' }

  it('preserves a busy claim across a same-name issuer refresh', () => {
    expect(reconcileClaimState({ kind: 'signing' }, unclaimed, null)).toStrictEqual({ kind: 'signing' })
    expect(reconcileClaimState({ kind: 'submitting', name: NAME }, unclaimed, null)).toStrictEqual({
      kind: 'submitting',
      name: NAME,
    })
  })

  it('preserves an in-memory receipt when storage is unavailable', () => {
    const state: ClaimState = { failure: 'unconfirmed', kind: 'failed', name: NAME, txHash: TX }
    expect(reconcileClaimState(state, unclaimed, null)).toBe(state)
  })

  it('lets authoritative claimed, unavailable, or renamed ENS replace local work', () => {
    const state: ClaimState = { failure: 'unconfirmed', kind: 'failed', name: NAME, txHash: TX }
    expect(reconcileClaimState(state, null, null)).toStrictEqual({ kind: 'unclaimed' })
    expect(reconcileClaimState(state, { ...unclaimed, name: 'other.fuda.eth' }, null)).toStrictEqual({
      kind: 'unclaimed',
    })
    expect(
      reconcileClaimState(state, { ...unclaimed, claimTxHash: TX, status: 'claimed' }, null),
    ).toMatchObject({
      kind: 'claimed',
    })
  })
})

describe(runClaim, () => {
  it('reports each leg in order and ends claimed', async () => {
    const { final, seen } = await run()

    expect(seen.map((state) => state.kind)).toStrictEqual(['signing', 'submitting', 'confirming', 'claimed'])
    expect(final).toStrictEqual({ claimTxHash: TX, kind: 'claimed', name: NAME })
  })

  it('names an unconfigured deployment rather than blaming the network', async () => {
    const { final } = await run({
      requestVoucher: async () => await Promise.resolve(fail('ens_not_configured')),
    })

    expect(final).toStrictEqual({ failure: 'unconfigured', kind: 'failed' })
  })

  it('separates a refused prompt from a paymaster that would not pay', async () => {
    const rejected = await run({
      submitClaim: async () => await Promise.reject(new Error('User rejected the request')),
    })
    const unsponsored = await run({
      submitClaim: async () => await Promise.reject(new Error('paymaster declined to sponsor')),
    })

    expect(rejected.final).toStrictEqual({ failure: 'rejected', kind: 'failed' })
    expect(unsponsored.final).toStrictEqual({ failure: 'unsponsored', kind: 'failed' })
  })

  it('stops at unconfirmed when the api cannot see the claim yet', async () => {
    const { final, seen } = await run({
      confirmClaim: async () => await Promise.resolve(fail('claim_unconfirmed')),
    })

    expect(final).toStrictEqual({
      failure: 'unconfirmed',
      kind: 'failed',
      name: 'wassie-coffee.fuda.eth',
      txHash: TX,
    })
    expect(seen.at(-2)?.kind).toBe('confirming')
  })

  it('retries only confirmation for a retained transaction', async () => {
    let requested = 0
    let submitted = 0
    const final = await runClaim(
      io({
        requestVoucher: async () => {
          requested += 1
          return await Promise.resolve(fail('unexpected'))
        },
        submitClaim: async () => {
          submitted += 1
          return await Promise.resolve(TX)
        },
      }),
      () => {},
      { name: NAME, txHash: TX },
    )
    expect(final.kind).toBe('claimed')
    expect({ requested, submitted }).toStrictEqual({ requested: 0, submitted: 0 })
  })

  it('discards a proven failed transaction so the next retry can start fresh', async () => {
    let pending: { name: string; txHash: Hex } | null = { name: NAME, txHash: TX }
    const final = await runClaim(
      io({
        confirmClaim: async () =>
          await Promise.resolve({ error: 'claim_failed', network: false, ok: false, status: 409 }),
      }),
      () => {},
      pending,
      (next) => {
        pending = next
      },
    )
    expect(final).toStrictEqual({ failure: 'unconfirmed', kind: 'failed' })
    expect(pending).toBeNull()
  })

  it('does not submit anything when the voucher never arrives', async () => {
    let submitted = false
    await run({
      requestVoucher: async () => await Promise.resolve(fail('network')),
      submitClaim: async () => {
        submitted = true
        return await Promise.resolve(TX)
      },
    })

    expect(submitted).toBe(false)
  })
})

describe(claimIsBusy, () => {
  it('is busy for exactly the three legs in flight', () => {
    const busy: ClaimState[] = [{ kind: 'signing' }, { kind: 'submitting', name: NAME }]
    const idle: ClaimState[] = [{ kind: 'unclaimed' }, { failure: 'network', kind: 'failed' }]

    expect(busy.map((state) => claimIsBusy(state))).toStrictEqual([true, true])
    expect(idle.map((state) => claimIsBusy(state))).toStrictEqual([false, false])
    expect(claimIsBusy({ kind: 'confirming', name: NAME })).toBe(true)
  })
})
