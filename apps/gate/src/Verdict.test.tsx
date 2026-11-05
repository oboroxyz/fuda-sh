// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { unreadableInput } from './verdict.ts'
import { Verdict } from './Verdict.tsx'

const disposers: (() => void)[] = []

describe(Verdict, () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
  })

  it('keeps the facts ordered under the verdict and the human badge after them', async () => {
    const onDone = vi.fn<() => void>()
    const view = mount(
      <Verdict
        onDone={onDone}
        state={{
          badge: { at: '2026-11-05 12:00', verifier: 'world' },
          detail: '',
          facts: {
            delegation: 'fuda root',
            holder: '0x123…456',
            tier: 'VIP',
            usage: 'multi-use',
            validUntil: '2027-01-01',
          },
          title: 'ADMIT',
          tone: 'green',
        }}
      />,
    )
    disposers.push(view.dispose)
    expect(view.host.textContent).toBe(
      'ADMITVIP · multi-usevalid until 2027-01-010x123…456issued under fuda rootverified human2026-11-05 12:00tap to scan again',
    )
    expect(view.host.querySelector('button')?.classList.contains('bg-success')).toBe(true)
    await settle(() => {
      view.host.querySelector('button')!.click()
    })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('keeps missing facts and badges out of a rejection and retains the network banner', () => {
    const view = mount(
      <Verdict
        onDone={() => {}}
        state={{ ...unreadableInput(), banner: 'network', title: 'REJECT', tone: 'red' }}
      />,
    )
    disposers.push(view.dispose)
    expect(view.host.textContent).toBe(
      'network error — gate fails closedREJECTnot a fuda passtap to scan again',
    )
    expect(view.host.querySelector('button')?.classList.contains('bg-error')).toBe(true)
    expect(view.host.querySelector('.text-xs')).toBeNull()
  })
})
