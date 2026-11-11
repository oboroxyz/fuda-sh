// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitQr, previewUid } from './api.ts'
import { App } from './App.tsx'
import type { ApiResult } from './verdict.ts'

vi.mock(import('./api.ts'), () => ({
  admitQr: vi.fn<typeof admitQr>(),
  previewUid: vi.fn<typeof previewUid>(),
}))

const UID = `0x${'a'.repeat(64)}`
const QR = `fuda:v1:${UID}`
const disposers: (() => void)[] = []
const admit = vi.mocked(admitQr)
const preview = vi.mocked(previewUid)

const scan = (text: string): void => {
  for (const key of text) {
    document.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, key }))
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, key: 'Enter' }))
}

const openGate = () => {
  const view = mount(<App />)
  disposers.push(view.dispose)
  return view
}

const rejected = (): ApiResult => ({ body: { decision: 'REJECT', reason: 'NOT_FOUND' }, ok: true })

describe(App, () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?camera=off&venue=alpha')
    admit.mockReset().mockResolvedValue(rejected())
    preview.mockReset().mockResolvedValue(rejected())
  })

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('installs the reader before mount returns and keeps camera-off stations field-free', async () => {
    const getUserMedia = vi.fn<MediaDevices['getUserMedia']>()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const { host } = openGate()
    expect({
      fields: host.querySelector('input, video, form'),
      hasVenue: host.textContent.includes('checking for @alpha'),
      hasWaitingLine: host.textContent.includes('present your pass'),
    }).toStrictEqual({ fields: null, hasVenue: true, hasWaitingLine: true })
    scan(QR)
    expect(admit).toHaveBeenCalledExactlyOnceWith(QR, 'alpha', expect.any(AbortSignal))
    await settle()
    expect(host.textContent).toContain('NOT_FOUND')
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('keeps a partial reader buffer across parent rerenders', async () => {
    const view = openGate()
    scan('not a pass')
    await settle()
    expect(view.host.textContent).toContain('not a fuda pass')
    for (const key of QR.slice(0, 15)) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key }))
    }
    view.update(<App />)
    scan(QR.slice(15))
    await settle()
    expect(admit).toHaveBeenCalledOnce()
    expect(view.host.textContent).toContain('NOT_FOUND')
  })

  it('queues only the latest scan during checking without showing the earlier verdict', async () => {
    const first = Promise.withResolvers<ApiResult>()
    const next = Promise.withResolvers<ApiResult>()
    admit.mockReturnValueOnce(first.promise)
    preview.mockReturnValueOnce(next.promise)
    const view = openGate()
    await settle(() => {
      scan(QR)
    })
    await settle(() => {
      scan(QR)
      scan(UID)
    })
    expect(view.host.textContent).toContain('only the latest scan')
    expect(admit).toHaveBeenCalledOnce()
    first.resolve({ body: { decision: 'ADMIT', reason: 'OK' }, ok: true })
    await settle()
    expect({
      checking: view.host.textContent.includes('checking pass'),
      previews: preview.mock.calls.length,
    }).toStrictEqual({ checking: true, previews: 1 })
    expect(view.host.textContent).not.toContain('ADMIT')
    next.resolve(rejected())
    await settle()
    expect(view.host.textContent).toContain('NOT_FOUND')
  })

  it('replaces a green verdict with neutral checking on the next scan', async () => {
    admit.mockResolvedValueOnce({ body: { decision: 'ADMIT', reason: 'OK' }, ok: true })
    const pending = Promise.withResolvers<ApiResult>()
    admit.mockReturnValueOnce(pending.promise)
    const { host } = openGate()
    scan(QR)
    await settle()
    expect(host.textContent).toContain('ADMIT')
    await settle(() => {
      scan(QR)
    })
    expect(host.textContent).toContain('checking pass')
    expect(host.textContent).not.toContain('ADMIT')
  })

  it('times out, aborts the request, and ignores a late admit', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<ApiResult>()
    admit.mockReturnValueOnce(pending.promise)
    const { host } = openGate()
    scan(QR)
    await settle()
    await settle(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(admit.mock.calls[0][2]?.aborted).toBe(true)
    expect(host.textContent).toContain('REJECT')
    expect(host.textContent).toContain('could not check, scan again')
    pending.resolve({ body: { decision: 'ADMIT', reason: 'OK' }, ok: true })
    await settle()
    expect(host.textContent).not.toContain('ADMIT')
  })

  it.each(['admit', 'preview'])('fails closed when %s throws', async (kind) => {
    admit.mockRejectedValueOnce(new Error('failed'))
    preview.mockRejectedValueOnce(new Error('failed'))
    const { host } = openGate()
    scan(kind === 'admit' ? QR : UID)
    await settle()
    expect(host.textContent).toContain('REJECT')
    expect(host.textContent).toContain('could not check, scan again')
  })

  it.each([
    ['ADMIT', 5000],
    ['REJECT', 10_000],
  ] as const)('auto-dismisses %s after %i ms', async (decision, delay) => {
    vi.useFakeTimers()
    if (decision === 'ADMIT') {
      admit.mockResolvedValueOnce({ body: { decision: 'ADMIT', reason: 'OK' }, ok: true })
    }
    const { host } = openGate()
    scan(QR)
    await settle()
    await settle(() => {
      vi.advanceTimersByTime(delay - 1)
    })
    expect(host.textContent).toContain(decision)
    await settle(() => {
      vi.advanceTimersByTime(1)
    })
    expect(host.textContent).toContain('present your pass')
  })

  it('clears the old dismissal timer on a new scan and all timers on unmount', async () => {
    vi.useFakeTimers()
    const { host, dispose } = openGate()
    scan(QR)
    await settle()
    await settle(() => {
      vi.advanceTimersByTime(9000)
    })
    const pending = Promise.withResolvers<ApiResult>()
    admit.mockReturnValueOnce(pending.promise)
    await settle(() => {
      scan(QR)
    })
    await settle(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(host.textContent).toContain('checking pass')
    dispose()
    expect(admit.mock.calls[1][2]?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the verdict timer on unmount', async () => {
    vi.useFakeTimers()
    const { dispose } = openGate()
    scan(QR)
    await settle()
    dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('previews a uid and catches the next scan while the verdict button has focus', async () => {
    const { host } = openGate()
    scan(UID)
    await settle()
    expect(preview).toHaveBeenCalledExactlyOnceWith(UID, expect.any(AbortSignal))
    const verdict = host.querySelector('button')!
    verdict.focus()
    let prevented = false
    await settle(() => {
      for (const key of QR) {
        verdict.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
      }
      const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
      verdict.dispatchEvent(enter)
      prevented = enter.defaultPrevented
    })
    expect(prevented).toBe(true)
    expect(admit).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('NOT_FOUND')
    await settle(() => {
      host.querySelector('button')!.click()
    })
    expect(host.textContent).toContain('present your pass')
  })

  it('uses the paste box without double-submitting its bubbled keys', async () => {
    window.history.replaceState(null, '', '/')
    const { host } = openGate()
    expect(host.textContent).toContain("no venue set: any shop's pass is admitted")
    const input = host.querySelector('input')!
    await settle(() => {
      input.value = QR
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(admit).not.toHaveBeenCalled()
    await settle(() => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(admit).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('NOT_FOUND')
  })

  it('removes the reader listener when disposed', () => {
    const view = openGate()
    view.dispose()
    scan(QR)
    expect(admit).not.toHaveBeenCalled()
  })
})
