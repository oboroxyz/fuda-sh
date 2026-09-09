// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { ReceptionPage } from './ReceptionPage.tsx'
import type { ReceptionIo } from './ReceptionPage.tsx'

let root: HTMLDivElement
const response = {
  decision: 'ADMIT',
  reason: 'OK',
  stamp: {
    status: 'awarded',
    summary: { dailyLimit: 1, enabled: true, goal: 10, today: 1, total: 4 },
  },
  uid: `0x${'ab'.repeat(32)}`,
} as const

const deferred = <T,>() => Promise.withResolvers<T>()

const input = (): HTMLInputElement => {
  const element = root.querySelector<HTMLInputElement>('input')
  if (element === null) {
    throw new Error('missing scanner input')
  }
  return element
}

const scan = async (qr: string): Promise<void> => {
  input().value = qr
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await setTimeout(0)
  input().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
}

describe(ReceptionPage, () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    root.remove()
  })

  it('submits one scan on Enter, blocks duplicate input while pending, and restores focus', async () => {
    const pending = deferred<Awaited<ReturnType<ReceptionIo>>>()
    const receive = vi.fn<ReceptionIo>().mockReturnValue(pending.promise)
    render(
      <ReceptionPage copy={DASH_COPY.en.reception} createRequestId={() => 'request-1'} receive={receive} />,
      root,
    )

    await scan('fuda:v1:member')
    input().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(receive).toHaveBeenCalledOnce()
    expect(root.textContent).not.toContain('ADMIT')

    pending.resolve({ body: response, ok: true })
    await vi.waitFor(() => {
      expect(root.textContent).toContain('ADMIT')
    })
    expect(root.textContent).toContain('Stamp awarded')
    expect(input().value).toBe('')
    expect(document.activeElement).toBe(input())
  })

  it('reads the complete scanner value when input and Enter arrive in one render frame', () => {
    const receive = vi.fn<ReceptionIo>().mockReturnValue(deferred<Awaited<ReturnType<ReceptionIo>>>().promise)
    render(
      <ReceptionPage copy={DASH_COPY.en.reception} createRequestId={() => 'id'} receive={receive} />,
      root,
    )
    input().value = 'fuda:v1:complete'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    input().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(receive).toHaveBeenCalledWith('fuda:v1:complete', 'id')
  })

  it('clears the previous verdict when the next scan starts', async () => {
    const second = deferred<Awaited<ReturnType<ReceptionIo>>>()
    const receive = vi
      .fn<ReceptionIo>()
      .mockResolvedValueOnce({ body: response, ok: true })
      .mockReturnValueOnce(second.promise)
    render(
      <ReceptionPage copy={DASH_COPY.en.reception} createRequestId={() => 'id'} receive={receive} />,
      root,
    )
    await scan('first')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('ADMIT')
    })
    await scan('second')
    expect(root.textContent).not.toContain('ADMIT')
  })

  it('offers an uncertain request for retry with the same request id', async () => {
    const receive = vi
      .fn<ReceptionIo>()
      .mockResolvedValueOnce({ error: 'network', network: true, ok: false, status: 0 })
      .mockResolvedValueOnce({ body: response, ok: true })
    render(
      <ReceptionPage copy={DASH_COPY.en.reception} createRequestId={() => 'stable-id'} receive={receive} />,
      root,
    )
    await scan('fuda:v1:member')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Try again')
    })
    root.querySelector<HTMLButtonElement>('button')?.click()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('ADMIT')
    })
    expect(receive.mock.calls).toStrictEqual([
      ['fuda:v1:member', 'stable-id'],
      ['fuda:v1:member', 'stable-id'],
    ])
  })

  /* oxlint-disable promise/prefer-await-to-callbacks, promise/no-promise-in-callback -- Vitest supplies each table row through this async callback. */
  it.each([
    ['not_found', 'This QR code belongs to another venue or is unknown.'],
    ['bad_qr', 'This is not a valid fuda QR code.'],
    ['bad_input', 'This scan could not be accepted. Scan the QR code again.'],
  ])('explains the %s scan failure', async (error, message) => {
    render(
      <ReceptionPage
        copy={DASH_COPY.en.reception}
        createRequestId={() => 'id'}
        receive={async () => await Promise.resolve({ error, network: false, ok: false, status: 400 })}
      />,
      root,
    )
    await scan('scan')
    await vi.waitFor(() => {
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(message)
    })
  })
  /* oxlint-enable promise/prefer-await-to-callbacks, promise/no-promise-in-callback */

  it('discards an in-flight result after the session IO is replaced', async () => {
    const pending = deferred<Awaited<ReturnType<ReceptionIo>>>()
    let replaceSession!: () => void
    const oldReceive = async (): Promise<Awaited<ReturnType<ReceptionIo>>> => await pending.promise
    const Harness = (): JSX.Element => {
      const [receive, setReceive] = useState<ReceptionIo>(() => oldReceive)
      replaceSession = () => {
        setReceive(
          () => async () =>
            await Promise.resolve({ error: 'new', network: false, ok: false as const, status: 400 }),
        )
      }
      return <ReceptionPage copy={DASH_COPY.en.reception} createRequestId={() => 'id'} receive={receive} />
    }
    render(<Harness />, root)
    await scan('old-session')
    replaceSession()
    await setTimeout(0)
    pending.resolve({ body: response, ok: true })
    await setTimeout(0)
    expect(root.textContent).not.toContain('ADMIT')
  })
})
