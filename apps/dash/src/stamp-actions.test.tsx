// @vitest-environment happy-dom
import type { StampActionResponse, StampSummary } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { render as solidRender } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { ReceptionPage } from './ReceptionPage.tsx'
import type { StampIo } from './StampActions.tsx'

const UID = `0x${'cd'.repeat(32)}` as const
const summary = (total: number): StampSummary => ({ dailyLimit: 1, enabled: true, goal: 10, today: 1, total })
const admitted = (total: number) =>
  ({
    body: {
      decision: 'ADMIT',
      reason: 'OK',
      stamp: { status: 'awarded', summary: summary(total) },
      uid: UID,
    },
    ok: true as const,
  }) as const

const done = (kind: 'adjust' | 'redeem', delta: number, total: number): Result<StampActionResponse> => ({
  body: {
    entries: [{ at: 1_757_000_000, delta, kind, note: kind === 'adjust' ? 'forgot' : '' }],
    entry: { at: 1_757_000_000, delta, kind, note: kind === 'adjust' ? 'forgot' : '' },
    summary: summary(total),
  },
  ok: true,
})

let dispose: () => void
let root: HTMLDivElement

const mount = (stamps: StampIo, total: number, lang: 'en' | 'ja' = 'en'): void => {
  dispose = solidRender(
    () => (
      <ReceptionPage
        copy={DASH_COPY[lang].reception}
        receive={async () => await Promise.resolve(admitted(total))}
        stamps={stamps}
      />
    ),
    root,
  )
}

const scan = async (): Promise<void> => {
  const input = root.querySelector('input')!
  input.value = `fuda:v1:${UID}`
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
  await vi.waitFor(() => {
    expect(root.querySelector('[data-testid="stamp-actions"]')).not.toBeNull()
  })
}

const button = (label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  if (found === undefined) {
    throw new Error(`no button "${label}"`)
  }
  return found
}

const baseIo = (total = 10): StampIo => ({
  adjust: vi.fn<StampIo['adjust']>(),
  ledger: vi.fn(
    async () => await Promise.resolve({ body: { entries: [], summary: summary(total) }, ok: true as const }),
  ),
  redeem: vi.fn<StampIo['redeem']>(),
})

describe('stamp actions at reception', () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    dispose()
    root.remove()
  })

  it('asks before giving the reward on a full card', async () => {
    const io = baseIo()
    mount(io, 10)
    await scan()
    expect(root.textContent).toContain('The card is full')
    button('Give the reward').click()
    expect(io.redeem).not.toHaveBeenCalled()
    expect(root.textContent).toContain('10 stamps come off this card')
  })

  it('records the reward, resets the count and lists it in the history', async () => {
    const io = baseIo()
    vi.mocked(io.redeem).mockResolvedValue(done('redeem', -10, 0))
    mount(io, 10)
    await scan()
    button('Give the reward').click()
    button('Yes, give the reward').click()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Reward recorded')
    })
    expect(io.redeem).toHaveBeenCalledExactlyOnceWith(UID, expect.any(String))
    expect(root.textContent).toContain('0 / 10')
    expect(root.textContent).toContain('Reward given')
  })

  it('hides the reward action below the goal but keeps the adjustment', async () => {
    const io = baseIo(4)
    mount(io, 4)
    await scan()
    expect(root.textContent).not.toContain('Give the reward')
    expect(root.textContent).toContain('Adjust')
  })

  it('retries an uncertain reward with the same request id', async () => {
    const io = baseIo()
    vi.mocked(io.redeem)
      .mockResolvedValueOnce({ error: 'network', network: true, ok: false, status: 0 })
      .mockResolvedValueOnce(done('redeem', -10, 0))
    mount(io, 10)
    await scan()
    button('Give the reward').click()
    button('Yes, give the reward').click()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('may not have been saved')
    })
    button('Try again').click()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Reward recorded')
    })
    const [first, second] = vi.mocked(io.redeem).mock.calls
    expect(first?.[1]).toBe(second?.[1])
  })

  it('ignores a second tap while the reward is saving', async () => {
    const io = baseIo()
    const pending = Promise.withResolvers<Result<StampActionResponse>>()
    vi.mocked(io.redeem).mockReturnValue(pending.promise)
    mount(io, 10)
    await scan()
    button('Give the reward').click()
    const confirm = button('Yes, give the reward')
    confirm.click()
    confirm.click()
    expect(io.redeem).toHaveBeenCalledOnce()
    pending.resolve(done('redeem', -10, 0))
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Reward recorded')
    })
  })

  it('sends a signed amount with a reason and shows the new count', async () => {
    const io = baseIo()
    vi.mocked(io.adjust).mockResolvedValue(done('adjust', -2, 8))
    mount(io, 10)
    await scan()
    button('Adjust').click()
    const [amount, reason] = [...root.querySelectorAll<HTMLInputElement>('form input')]
    amount.value = '-2'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    reason.value = ' counted twice '
    reason.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Change saved')
    })
    expect(io.adjust).toHaveBeenCalledWith(UID, -2, 'counted twice', expect.any(String))
    expect(root.textContent).toContain('8 / 10')
  })

  it('does not call the api without a usable amount and reason', async () => {
    const io = baseIo()
    mount(io, 10)
    await scan()
    button('Adjust').click()
    const submit = (): void => {
      root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }
    submit()
    expect(io.adjust).not.toHaveBeenCalled()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('whole number')
    const [amount, reason] = [...root.querySelectorAll<HTMLInputElement>('form input')]
    amount.value = '99'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    reason.value = 'why'
    reason.dispatchEvent(new Event('input', { bubbles: true }))
    submit()
    expect(io.adjust).not.toHaveBeenCalled()
  })

  it('explains a refusal from the api', async () => {
    const io = baseIo()
    vi.mocked(io.redeem).mockResolvedValue({ error: 'revoked', network: false, ok: false, status: 409 })
    mount(io, 10)
    await scan()
    button('Give the reward').click()
    button('Yes, give the reward').click()
    await vi.waitFor(() => {
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('revoked')
    })
  })

  it('shows the recent history and speaks Japanese', async () => {
    const io = baseIo()
    vi.mocked(io.ledger).mockResolvedValue({
      body: {
        entries: [{ at: 1_757_000_000, delta: 3, kind: 'adjust', note: '押し忘れ' }],
        summary: summary(10),
      },
      ok: true,
    })
    mount(io, 10, 'ja')
    await scan()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('押し忘れ')
    })
    expect(root.textContent).toContain('特典を渡す')
    expect(root.textContent).toContain('+3')
  })
})
