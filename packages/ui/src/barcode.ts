// lib.dom has no BarcodeDetector yet; this is the subset the scanner uses.
export interface DetectedBarcode {
  rawValue: string
}
export interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

// oxlint-disable-next-line anti-slop/no-unknown-parameters anti-slop/no-runtime-typeof -- browser feature detection must validate an untyped optional global
const isBarcodeDetectorCtor = (value: unknown): value is BarcodeDetectorCtor => typeof value === 'function'

// null when the browser has no BarcodeDetector (desktop Firefox, older Safari) —
// the paste fallback still works.
export const createQrDetector = (): BarcodeDetectorLike | null => {
  // oxlint-disable-next-line anti-slop/no-reflect-get -- BarcodeDetector is not declared by lib.dom
  const ctor: unknown = Reflect.get(globalThis, 'BarcodeDetector')
  return isBarcodeDetectorCtor(ctor) ? new ctor({ formats: ['qr_code'] }) : null
}
