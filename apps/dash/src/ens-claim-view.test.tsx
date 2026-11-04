// @vitest-environment happy-dom
import { pick } from '@fuda/i18n'
import { afterEach, describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { ClaimState } from './ens-claim.ts'
import { EnsClaim } from './EnsClaim.tsx'
import { cleanup, mount, textOf } from './test/render.tsx'

const copy = pick(DASH_COPY, 'en').ens
const NAME = 'wassie-coffee.fuda.eth'
const OWNER = `0x${'12'.repeat(20)}` as const
const TX = `0x${'ab'.repeat(32)}` as const

const noop = (): void => {
  // the button's press is exercised by the state machine's own tests
}

const show = (state: ClaimState): HTMLElement =>
  mount(() => <EnsClaim copy={copy} name={NAME} onClaim={noop} ownerAddress={OWNER} state={state} />)

describe(EnsClaim, () => {
  afterEach(cleanup)

  it('names the venue before it is claimed and offers the button', () => {
    const host = show({ kind: 'unclaimed' })

    expect(textOf(host)).toContain(NAME)
    expect(textOf(host)).toContain(copy.claim)
    expect(host.querySelector('button')?.disabled).toBe(false)
  })

  it('says a wallet is needed instead of offering a claim, when no wallet owns the venue', () => {
    const host = mount(() => (
      <EnsClaim copy={copy} name={NAME} onClaim={noop} ownerAddress={null} state={{ kind: 'unclaimed' }} />
    ))

    expect(textOf(host)).toContain(NAME)
    expect(textOf(host)).toContain(copy.walletRequired)
    expect(host.querySelector('button')).toBeNull()
  })

  it('disables the button and says which leg is in flight', () => {
    const host = show({ kind: 'submitting', name: NAME })

    expect(textOf(host)).toContain(copy.submitting)
    expect(host.querySelector('button')?.disabled).toBe(true)
  })

  it.each([TX, null])('links the claimed name to its owner with transaction %s', (claimTxHash) => {
    const host = show({ claimTxHash, kind: 'claimed', name: NAME })

    expect(textOf(host)).toContain(copy.claimedLabel)
    const link = host.querySelector('a')
    expect(link?.getAttribute('href')).toBe(`https://sepolia.etherscan.io/address/${OWNER}`)
    expect(textOf(link)).toBe(NAME)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(host.querySelector('button')).toBeNull()
  })

  it('gives each failure its own sentence and offers a retry', () => {
    const rejected = show({ failure: 'rejected', kind: 'failed' })
    const unsponsored = show({ failure: 'unsponsored', kind: 'failed' })

    expect(textOf(rejected)).toContain(copy.failures.rejected)
    expect(textOf(unsponsored)).toContain(copy.failures.unsponsored)
    expect(textOf(rejected)).toContain(copy.retry)
  })

  it('marks the failure line for assistive technology', () => {
    const host = show({ failure: 'network', kind: 'failed' })

    expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })
})
