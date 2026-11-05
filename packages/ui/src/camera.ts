import { createFrameDecoder } from './barcode.ts'

interface CameraInput {
  onCode: (text: string) => void
  onState: (state: 'on' | 'done' | 'unavailable') => void
  video: HTMLVideoElement
}

interface CameraSession {
  release: () => void
}

// One decode per tick is plenty for a QR held still, and a phone screen at a
// full 30 fps decode would heat an iPad for nothing.
const SCAN_INTERVAL_MS = 120
// A larger frame costs the JS decoder time without helping a code that fills a
// third of it.
const MAX_FRAME_SIDE = 960

export const startCamera = ({ video, onCode, onState }: CameraInput): CameraSession => {
  const decodeFrame = createFrameDecoder()
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  let stream: MediaStream | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let decoding = false

  const lifetime = new AbortController()
  const release = (): void => {
    stopped = true
    clearTimeout(timer)
    lifetime.abort()
    for (const track of stream?.getTracks() ?? []) {
      track.stop()
    }
  }
  const schedule = (run: () => Promise<void>): void => {
    clearTimeout(timer)
    if (!stopped && !document.hidden) {
      timer = setTimeout(() => {
        void run()
      }, SCAN_INTERVAL_MS)
    }
  }
  const tick = async (): Promise<void> => {
    if (stopped || decoding || context === null) {
      return
    }
    decoding = true
    try {
      if (video.videoWidth > 0) {
        const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const text = await decodeFrame(context.getImageData(0, 0, canvas.width, canvas.height))
        if (stopped) {
          return
        }
        if (text !== null) {
          // The member app keeps this component on screen after a read; a lit
          // camera with nothing scanning would only drain the battery, and the
          // video would be left as a black frame above the result.
          release()
          onState('done')
          onCode(text)
          return
        }
      }
    } catch {
      // a frame that cannot be decoded is not an error
    } finally {
      decoding = false
    }
    schedule(tick)
  }
  const onVisibility = (): void => {
    if (document.hidden) {
      clearTimeout(timer)
    } else {
      schedule(tick)
    }
  }
  const start = async (): Promise<void> => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      // A stream that arrives after cleanup would keep the camera lit forever.
      if (stopped) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }
      video.srcObject = stream
      await video.play()
      if (stopped) {
        return
      }
      onState('on')
      schedule(tick)
    } catch {
      if (stopped) {
        return
      }
      release()
      onState('unavailable')
    }
  }
  document.addEventListener('visibilitychange', onVisibility, { signal: lifetime.signal })
  void start()
  return { release }
}
