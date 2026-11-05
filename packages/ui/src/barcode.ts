// lib.dom has no BarcodeDetector yet; this is the subset the scanner uses.
interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

// The shape of ImageData, so a test can pass a plain buffer and the decoder
// never needs a canvas of its own.
export interface FrameImage {
  data: Uint8ClampedArray<ArrayBuffer>
  height: number
  width: number
}

export type DecodeFrame = (frame: FrameImage) => Promise<string | null>

// oxlint-disable-next-line anti-slop/no-unknown-parameters anti-slop/no-runtime-typeof -- browser feature detection must validate an untyped optional global
const isBarcodeDetectorCtor = (value: unknown): value is BarcodeDetectorCtor => typeof value === 'function'

const nativeDetector = (): BarcodeDetectorLike | null => {
  // oxlint-disable-next-line anti-slop/no-reflect-get -- BarcodeDetector is not declared by lib.dom
  const ctor: unknown = Reflect.get(globalThis, 'BarcodeDetector')
  try {
    return isBarcodeDetectorCtor(ctor) ? new ctor({ formats: ['qr_code'] }) : null
  } catch {
    // Present but unusable, such as a build without a QR backend.
    return null
  }
}

const loadJsQr = async (): Promise<(frame: FrameImage) => string | null> => {
  const { default: jsQR } = await import('jsqr')
  // qrSvg always draws black on white in either theme, so the second, inverted
  // pass would only double the cost of every empty frame on an iPad.
  return (frame) =>
    jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ?? null
}

// Reads one QR code from a frame, or null. The browser's own BarcodeDetector
// goes first where it exists. Safari has none, so the JS decoder is fetched the
// first time it is needed and never otherwise. A detector that throws is
// dropped for good: Chrome on Linux exposes the constructor and then rejects
// every detect(), and retrying it would mean no scan at all.
export const createFrameDecoder = (): DecodeFrame => {
  let native = nativeDetector()
  let fallback: Promise<(frame: FrameImage) => string | null> | null = null
  return async (frame) => {
    if (native !== null) {
      try {
        const [first] = await native.detect(new ImageData(frame.data, frame.width, frame.height))
        return first?.rawValue ?? null
      } catch {
        native = null
      }
    }
    fallback ??= loadJsQr()
    try {
      return (await fallback)(frame)
    } catch (error) {
      // A failed chunk fetch must not be cached, or a brief offline moment
      // would end scanning until the page is reloaded.
      fallback = null
      throw error
    }
  }
}
