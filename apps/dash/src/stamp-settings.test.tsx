import { setTimeout } from 'node:timers/promises'

// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render, useState } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { StampSettings } from './StampSettings.tsx'
import type { StampSettingsProps } from './StampSettings.tsx'

const deferred = <T,>() => Promise.withResolvers<T>()

let root: HTMLDivElement

describe(StampSettings, () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    root.remove()
  })

  it('validates both numeric bounds before saving settings', async () => {
    const save = vi.fn<StampSettingsProps['save']>().mockResolvedValue({
      body: { dailyLimit: 1, enabled: true, goal: 10 },
      ok: true,
    })
    render(
      <StampSettings
        copy={DASH_COPY.en.stamps}
        load={async () =>
          await Promise.resolve({ body: { dailyLimit: 1, enabled: false, goal: 10 }, ok: true })
        }
        save={save}
      />,
      root,
    )
    await vi.waitFor(() => {
      expect(root.querySelector('form')).not.toBeNull()
    })
    const numbers = root.querySelectorAll<HTMLInputElement>('input[type="number"]')
    numbers[0].value = '0'
    numbers[0].dispatchEvent(new Event('input', { bubbles: true }))
    await setTimeout(0)
    numbers[1].value = '1001'
    numbers[1].dispatchEvent(new Event('input', { bubbles: true }))
    await setTimeout(0)
    root.querySelector<HTMLButtonElement>('button')?.click()
    await setTimeout(0)
    expect(save).not.toHaveBeenCalled()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('1–100')
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('1–1000')
  })

  it('discards an old session load when the loader is replaced', async () => {
    const old = deferred<{ body: { dailyLimit: number; enabled: boolean; goal: number }; ok: true }>()
    let replace!: () => void
    // oxlint-disable-next-line typescript/promise-function-async -- useState's lazy initializer returns the async loader rather than running it.
    const Harness = () => {
      const [load, setLoad] = useState(() => async () => await old.promise)
      replace = () => {
        setLoad(
          () => async () =>
            await Promise.resolve({ body: { dailyLimit: 2, enabled: true, goal: 20 }, ok: true as const }),
        )
      }
      return (
        <StampSettings copy={DASH_COPY.en.stamps} load={load} save={vi.fn<StampSettingsProps['save']>()} />
      )
    }
    render(<Harness />, root)
    replace()
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('2')
    })
    old.resolve({ body: { dailyLimit: 99, enabled: false, goal: 999 }, ok: true })
    await setTimeout(0)
    expect(root.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('2')
  })

  it('prevents duplicate saves, locks editing, and confirms completion', async () => {
    const pending = deferred<{ body: { dailyLimit: number; enabled: boolean; goal: number }; ok: true }>()
    const save = vi.fn<StampSettingsProps['save']>().mockReturnValue(pending.promise)
    render(
      <StampSettings
        copy={DASH_COPY.en.stamps}
        load={async () =>
          await Promise.resolve({ body: { dailyLimit: 1, enabled: true, goal: 10 }, ok: true })
        }
        save={save}
      />,
      root,
    )
    await vi.waitFor(() => {
      expect(root.querySelector('form')).not.toBeNull()
    })
    root.querySelector<HTMLButtonElement>('button')?.click()
    root.querySelector<HTMLButtonElement>('button')?.click()
    expect(save).toHaveBeenCalledOnce()
    await setTimeout(0)
    expect([...root.querySelectorAll('input')].every((field) => field.disabled)).toBe(true)
    pending.resolve({ body: { dailyLimit: 1, enabled: true, goal: 10 }, ok: true })
    await vi.waitFor(() => {
      expect(root.querySelector('[role="status"]')?.textContent).toContain('Saved')
    })
  })

  it('recovers from a failed load through Retry', async () => {
    const load = vi
      .fn<StampSettingsProps['load']>()
      .mockResolvedValueOnce({ error: 'network', network: true, ok: false, status: 0 })
      .mockResolvedValueOnce({ body: { dailyLimit: 1, enabled: false, goal: 10 }, ok: true })
    render(
      <StampSettings copy={DASH_COPY.en.stamps} load={load} save={vi.fn<StampSettingsProps['save']>()} />,
      root,
    )
    await vi.waitFor(() => {
      expect(root.querySelector('button')?.textContent).toContain('Retry')
    })
    root.querySelector<HTMLButtonElement>('button')?.click()
    await vi.waitFor(() => {
      expect(root.querySelector('form')).not.toBeNull()
    })
  })
})
