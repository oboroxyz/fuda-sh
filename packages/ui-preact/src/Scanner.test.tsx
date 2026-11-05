// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Scanner } from './Scanner.tsx'

const disposers: (() => void)[] = []

// happy-dom has no navigator.mediaDevices, so getUserMedia fails and every
// render here takes the camera-unavailable branch, the same one a desk with a
// denied or missing camera runs in.
const openScanner = (props: { autoFocus?: boolean; cameraMode?: 'auto' | 'off' }): HTMLElement => {
  const view = mount(<Scanner onInput={() => {}} {...props} />)
  disposers.push(view.dispose)
  return view.host
}

describe(Scanner, () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
    vi.restoreAllMocks()
  })

  it('leaves focus alone by default, so a member phone keeps its keyboard down', async () => {
    const host = openScanner({})
    await vi.waitFor(() => {
      expect(host.querySelector('input')).not.toBeNull()
    })
    expect(document.activeElement).not.toBe(host.querySelector('input'))
  })

  it('focuses the input when asked, so a wedge scanner needs no click', async () => {
    const host = openScanner({ autoFocus: true })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(host.querySelector('input'))
    })
  })

  it('takes focus back after a stray click, so the next scan still lands', async () => {
    const host = openScanner({ autoFocus: true })
    await vi.waitFor(() => {
      expect(host.querySelector('input')).not.toBeNull()
    })
    const input = host.querySelector('input')!
    input.blur()
    expect(document.activeElement).not.toBe(input)
    host.querySelector('form')!.parentElement!.click()
    expect(document.activeElement).toBe(input)
  })

  it('shows only a waiting line with the camera off with no field, no warning', async () => {
    const host = openScanner({ cameraMode: 'off' })
    await vi.waitFor(() => {
      expect(host.textContent).toContain('present your pass')
    })
    expect(host.querySelector('input')).toBeNull()
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('video')).toBeNull()
    expect(host.querySelector('.badge')).toBeNull()
  })

  it('takes the waiting line from the supplied labels', async () => {
    const { host, dispose } = mount(
      <Scanner
        cameraMode="off"
        labels={{ cameraUnavailable: 'x', check: 'y', placeholder: 'z', ready: 'パスをかざしてください' }}
        onInput={() => {}}
      />,
    )
    disposers.push(dispose)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('パスをかざしてください')
    })
  })

  it('submits the current field value even when Enter follows input in the same tick', async () => {
    const onInput = vi.fn<(text: string) => void>()
    const view = mount(<Scanner autoFocus onInput={onInput} />)
    disposers.push(view.dispose)
    const input = view.host.querySelector('input')!
    expect(document.activeElement).toBe(input)
    await settle(() => {
      input.value = 'fuda:v1:immediate'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      view.host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    })
    expect(onInput).toHaveBeenCalledExactlyOnceWith('fuda:v1:immediate')
  })

  it('drops the dead video frame when no camera can be used', async () => {
    const host = openScanner({ autoFocus: true })
    await vi.waitFor(() => {
      expect(host.querySelector('.badge')).not.toBeNull()
    })
    expect(host.querySelector('video')).toBeNull()
  })
})

const fakeCamera = () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const stop = vi.fn<() => void>()
  const stream = new MediaStream()
  Object.defineProperty(stream, 'getTracks', { value: () => [{ stop }] })
  const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue(stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(async function playVideo(this: HTMLVideoElement) {
      Object.defineProperties(this, {
        videoHeight: { configurable: true, value: 480 },
        videoWidth: { configurable: true, value: 640 },
      })
      await Promise.resolve()
    })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn<CanvasRenderingContext2D['drawImage']>(),
    getImageData: () => new ImageData(new Uint8ClampedArray(4), 1, 1),
  } as unknown as CanvasRenderingContext2D)
  const detect = vi.fn<() => Promise<{ rawValue: string }[]>>().mockResolvedValue([])
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      detect = detect
    },
  )
  return { detect, getUserMedia, play, stop, stream }
}

describe('camera lifetime', () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps one camera across parent rerenders and delivers to the current callback', async () => {
    vi.useFakeTimers()
    const camera = fakeCamera()
    const oldInput = vi.fn<(text: string) => void>()
    const latestInput = vi.fn<(text: string) => void>()
    const view = mount(<Scanner onInput={oldInput} />)
    disposers.push(view.dispose)
    await settle()
    expect(view.host.querySelector('video')?.srcObject).toBe(camera.stream)
    view.update(<Scanner onInput={latestInput} />)
    camera.detect.mockResolvedValue([{ rawValue: 'fuda:v1:current' }])
    await settle(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })
    expect(camera.getUserMedia).toHaveBeenCalledOnce()
    expect(latestInput).toHaveBeenCalledExactlyOnceWith('fuda:v1:current')
    expect(oldInput).not.toHaveBeenCalled()
    expect({
      badge: view.host.querySelector('.badge'),
      input: view.host.querySelector('input')?.tagName,
      stops: camera.stop.mock.calls.length,
      video: view.host.querySelector('video'),
    }).toStrictEqual({ badge: null, input: 'INPUT', stops: 1, video: null })
  })

  it('stops a camera acquired after disposal without playing it', async () => {
    const camera = fakeCamera()
    const pending = Promise.withResolvers<MediaStream>()
    camera.getUserMedia.mockReturnValue(pending.promise)
    const onInput = vi.fn<(text: string) => void>()
    const view = mount(<Scanner onInput={onInput} />)
    disposers.push(view.dispose)
    view.dispose()
    pending.resolve(camera.stream)
    await settle()
    expect(camera.stop).toHaveBeenCalledOnce()
    expect(camera.play).not.toHaveBeenCalled()
    expect(onInput).not.toHaveBeenCalled()
  })

  it('releases the stream on unmount and suppresses a pending decode', async () => {
    vi.useFakeTimers()
    const camera = fakeCamera()
    const pending = Promise.withResolvers<{ rawValue: string }[]>()
    camera.detect.mockReturnValue(pending.promise)
    const onInput = vi.fn<(text: string) => void>()
    const view = mount(<Scanner onInput={onInput} />)
    disposers.push(view.dispose)
    await settle(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })
    expect(camera.detect).toHaveBeenCalledOnce()
    view.dispose()
    pending.resolve([{ rawValue: 'late' }])
    await settle(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(camera.stop).toHaveBeenCalledOnce()
    expect(onInput).not.toHaveBeenCalled()
    expect(camera.detect).toHaveBeenCalledOnce()
  })
})
