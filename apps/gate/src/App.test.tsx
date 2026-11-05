// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
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
    expect(admit).toHaveBeenCalledExactlyOnceWith(QR, 'alpha')
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

  it('blocks duplicate reads in the same tick and across rerenders until verification finishes', async () => {
    const pending = Promise.withResolvers<ApiResult>()
    admit.mockReturnValueOnce(pending.promise)
    const view = openGate()
    scan(QR)
    scan(QR)
    view.update(<App />)
    scan(QR)
    expect(admit).toHaveBeenCalledOnce()
    pending.resolve(rejected())
    await settle()
    scan(QR)
    await settle()
    expect(admit).toHaveBeenCalledTimes(2)
  })

  it('previews a uid and catches the next scan while the verdict button has focus', async () => {
    const { host } = openGate()
    scan(UID)
    await settle()
    expect(preview).toHaveBeenCalledExactlyOnceWith(UID)
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
      verdict.click()
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
