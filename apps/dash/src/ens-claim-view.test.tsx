/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { ClaimState } from './ens-claim.ts'
import { EnsClaim } from './EnsClaim.tsx'
import { viewProps, viewText, walkView } from './test/test-view.ts'

const copy = pick(DASH_COPY, 'en').ens
const NAME = 'wassie-coffee.fuda.eth'
const TX = `0x${'ab'.repeat(32)}` as const

const noop = (): void => {
  // the button's press is exercised by the state machine's own tests
}

const render = (state: ClaimState): JSX.Element => EnsClaim({ copy, name: NAME, onClaim: noop, state })

describe(EnsClaim, () => {
  it('names the venue before it is claimed and offers the button', () => {
    const view = render({ kind: 'unclaimed' })

    expect(viewText(view)).toContain(NAME)
    expect(viewText(view)).toContain(copy.claim)
    expect(walkView(view).some((node) => viewProps(node).disabled === true)).toBe(false)
  })

  it('disables the button and says which leg is in flight', () => {
    const submitting = render({ kind: 'submitting', name: NAME })

    expect(viewText(submitting)).toContain(copy.submitting)
    expect(walkView(submitting).some((node) => viewProps(node).disabled === true)).toBe(true)
  })

  it('shows the claimed name with its transaction and drops the button', () => {
    const view = render({ claimTxHash: TX, kind: 'claimed', name: NAME })

    expect(viewText(view)).toContain(copy.claimedLabel)
    expect(walkView(view).map((node) => viewProps(node).href)).toContain(
      `https://sepolia.etherscan.io/tx/${TX}`,
    )
    expect(viewText(view)).not.toContain(copy.claim)
  })

  it('gives each failure its own sentence and offers a retry', () => {
    const rejected = render({ failure: 'rejected', kind: 'failed' })
    const unsponsored = render({ failure: 'unsponsored', kind: 'failed' })

    expect(viewText(rejected)).toContain(copy.failures.rejected)
    expect(viewText(unsponsored)).toContain(copy.failures.unsponsored)
    expect(viewText(rejected)).toContain(copy.retry)
  })

  it('marks the failure line for assistive technology', () => {
    const view = render({ failure: 'network', kind: 'failed' })

    expect(walkView(view).some((node) => viewProps(node).role === 'alert')).toBe(true)
  })
})
