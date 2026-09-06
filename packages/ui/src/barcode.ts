// lib.dom has no BarcodeDetector yet; this is the subset the scanner uses.
export interface DetectedBarcode {
  rawValue: string
}
export interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

// null when the browser has no BarcodeDetector (desktop Firefox, older Safari) —
// the paste fallback still works.
export const createQrDetector = (): BarcodeDetectorLike | null => {
  // SAFETY: feature detection of an optional Web API not in lib.dom
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis carries no type for it
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor === undefined ? null : new ctor({ formats: ['qr_code'] })
}
