// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFrameDecoder } from './barcode.ts'
import { startCamera } from './camera.ts'

vi.mock(import('./barcode.ts'), () => ({ createFrameDecoder: vi.fn<typeof createFrameDecoder>() }))

const setup = () => {
  const decode = vi.fn<ReturnType<typeof createFrameDecoder>>().mockResolvedValue(null)
  vi.mocked(createFrameDecoder).mockReturnValue(decode)
  const stop = vi.fn<() => void>()
  // SAFETY: The camera only reads getTracks and stops the returned tracks.
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue(stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const video = document.createElement('video')
  Object.defineProperties(video, {
    srcObject: { value: null, writable: true },
    videoHeight: { configurable: true, value: 1080 },
    videoWidth: { configurable: true, value: 1920 },
  })
  const play = vi.spyOn(video, 'play').mockResolvedValue()
  const drawImage = vi.fn<CanvasRenderingContext2D['drawImage']>()
  const getImageData = vi.fn<CanvasRenderingContext2D['getImageData']>().mockReturnValue({
    data: new Uint8ClampedArray(4),
    height: 1,
    width: 1,
  } as ImageData)
  // SAFETY: The camera uses only these two canvas methods.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    getImageData,
  } as unknown as CanvasRenderingContext2D)
  const onCode = vi.fn<Parameters<typeof startCamera>[0]['onCode']>()
  const onState = vi.fn<Parameters<typeof startCamera>[0]['onState']>()
  return { decode, drawImage, getImageData, getUserMedia, onCode, onState, play, stop, stream, video }
}

type CameraFixture = ReturnType<typeof setup>

const releases: (() => void)[] = []

const openCamera = (fixture: CameraFixture): ReturnType<typeof startCamera> => {
  const session = startCamera(fixture)
  releases.push(session.release)
  return session
}

const setHidden = (hidden: boolean): void => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
  document.dispatchEvent(new Event('visibilitychange'))
}

describe(startCamera, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  })

  afterEach(() => {
    for (const release of releases.splice(0)) {
      release()
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('requests and plays the rear camera', async () => {
    const fixture = setup()
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: 'environment' } })
    expect(fixture.video.srcObject).toBe(fixture.stream)
    expect(fixture.onState).toHaveBeenCalledExactlyOnceWith('on')
  })

  it('decodes at 120 ms intervals', async () => {
    const fixture = setup()
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(119)
    expect(fixture.decode).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.decode).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(119)
    expect(fixture.decode).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.decode).toHaveBeenCalledTimes(2)
  })

  it.each([
    [1920, 1080, 960, 540],
    [1080, 1920, 540, 960],
    [640, 480, 640, 480],
  ])(
    'copies a %i by %i video into a %i by %i frame',
    async (width, height, expectedWidth, expectedHeight) => {
      const fixture = setup()
      Object.defineProperties(fixture.video, {
        videoHeight: { value: height },
        videoWidth: { value: width },
      })
      openCamera(fixture)
      await vi.advanceTimersByTimeAsync(120)
      expect(fixture.drawImage).toHaveBeenCalledExactlyOnceWith(
        fixture.video,
        0,
        0,
        expectedWidth,
        expectedHeight,
      )
      expect(fixture.getImageData).toHaveBeenCalledExactlyOnceWith(0, 0, expectedWidth, expectedHeight)
    },
  )

  it('stops the tracks before delivering the first code and never reads another', async () => {
    const fixture = setup()
    fixture.decode.mockResolvedValue('fuda:v1:first')
    fixture.onCode.mockImplementation(() => {
      expect(fixture.stop).toHaveBeenCalledOnce()
    })
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(120)
    expect(fixture.onCode).toHaveBeenCalledExactlyOnceWith('fuda:v1:first')
    expect(fixture.onState).toHaveBeenLastCalledWith('done')
    setHidden(true)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.decode).toHaveBeenCalledOnce()
    expect(fixture.onCode).toHaveBeenCalledOnce()
  })

  it('releases a stream that arrives after teardown without attaching or playing it', async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<MediaStream>()
    fixture.getUserMedia.mockReturnValue(pending.promise)
    const session = openCamera(fixture)
    session.release()
    pending.resolve(fixture.stream)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.stop).toHaveBeenCalledOnce()
    expect(fixture.video.srcObject).toBeNull()
    expect(fixture.play).not.toHaveBeenCalled()
    expect(fixture.onState).not.toHaveBeenCalled()
    expect(fixture.decode).not.toHaveBeenCalled()
  })

  it('pauses decoding while hidden and resumes when visible', async () => {
    const fixture = setup()
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(120)
    expect(fixture.decode).toHaveBeenCalledOnce()
    setHidden(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.decode).toHaveBeenCalledOnce()
    setHidden(false)
    await vi.advanceTimersByTimeAsync(120)
    expect(fixture.decode).toHaveBeenCalledTimes(2)
  })

  it('does not start decoding until an initially hidden page is shown', async () => {
    const fixture = setup()
    setHidden(true)
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.decode).not.toHaveBeenCalled()
    setHidden(false)
    await vi.advanceTimersByTimeAsync(120)
    expect(fixture.decode).toHaveBeenCalledOnce()
  })

  it('aborts the visibility listener and cancels the pending frame on teardown', async () => {
    const fixture = setup()
    const addListener = vi.spyOn(document, 'addEventListener')
    const session = openCamera(fixture)
    await vi.advanceTimersByTimeAsync(0)
    const visibility = addListener.mock.calls.find(([name]) => name === 'visibilitychange')
    // SAFETY: startCamera registers this listener with AddEventListenerOptions.
    const options = visibility?.[2] as AddEventListenerOptions
    expect(options.signal?.aborted).toBe(false)
    session.release()
    expect(options.signal?.aborted).toBe(true)
    setHidden(true)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.stop).toHaveBeenCalledOnce()
    expect(fixture.decode).not.toHaveBeenCalled()
  })

  it('discards a code decoded after teardown', async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<string | null>()
    fixture.decode.mockReturnValue(pending.promise)
    const session = openCamera(fixture)
    await vi.advanceTimersByTimeAsync(120)
    session.release()
    fixture.onState.mockClear()
    pending.resolve('fuda:v1:late')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.onCode).not.toHaveBeenCalled()
    expect(fixture.onState).not.toHaveBeenCalled()
    expect(fixture.decode).toHaveBeenCalledOnce()
  })

  it('retries after a frame cannot be decoded', async () => {
    const fixture = setup()
    fixture.decode.mockRejectedValueOnce(new Error('bad frame')).mockResolvedValue('fuda:v1:next')
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(240)
    expect(fixture.onCode).toHaveBeenCalledExactlyOnceWith('fuda:v1:next')
  })

  it('releases the camera when playback fails', async () => {
    const fixture = setup()
    fixture.play.mockRejectedValue(new Error('playback failed'))
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.onState).toHaveBeenCalledExactlyOnceWith('unavailable')
    expect(fixture.stop).toHaveBeenCalledOnce()
    expect(fixture.decode).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores playback that completes with %s after teardown',
    async (outcome) => {
      const fixture = setup()
      const pending = Promise.withResolvers<Awaited<ReturnType<typeof fixture.play>>>()
      fixture.play.mockReturnValue(pending.promise)
      const session = openCamera(fixture)
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.play).toHaveBeenCalledOnce()
      session.release()
      if (outcome === 'resolve') {
        pending.resolve()
      } else {
        pending.reject(new Error('unmounted'))
      }
      await vi.advanceTimersByTimeAsync(1000)
      expect(fixture.onState).not.toHaveBeenCalled()
      expect(fixture.decode).not.toHaveBeenCalled()
      expect(fixture.stop).toHaveBeenCalledOnce()
    },
  )

  it('does not overlap a pending decode when visibility changes', async () => {
    const fixture = setup()
    const pending = Promise.withResolvers<string | null>()
    fixture.decode.mockReturnValueOnce(pending.promise)
    openCamera(fixture)
    await vi.advanceTimersByTimeAsync(120)
    expect(fixture.decode).toHaveBeenCalledOnce()
    setHidden(true)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(120)
    expect(fixture.decode).toHaveBeenCalledOnce()
    pending.resolve(null)
    await vi.advanceTimersByTimeAsync(120)
    expect(fixture.decode).toHaveBeenCalledTimes(2)
  })
})
