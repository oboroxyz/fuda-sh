import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFrameDecoder } from './barcode.ts'
import type { FrameImage } from './barcode.ts'

const PASS_QR = /^fuda:v1:0x[0-9a-f]{64}$/u

// The real pass QR as issued, a 45-unit grid of one-unit dark squares.
const svg = readFileSync(new URL('fixtures/pass-qr.svg', import.meta.url), 'utf-8')

const renderPassQr = (pixelsPerModule: number): FrameImage => {
  const side = 45 * pixelsPerModule
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (const { groups } of svg.matchAll(/M(?<x>\d+) (?<y>\d+)h1v1h-1z/gu)) {
    const mx = Number(groups?.x)
    const my = Number(groups?.y)
    for (let dy = 0; dy < pixelsPerModule; dy += 1) {
      for (let dx = 0; dx < pixelsPerModule; dx += 1) {
        const at = ((my * pixelsPerModule + dy) * side + mx * pixelsPerModule + dx) * 4
        data.fill(0, at, at + 3)
      }
    }
  }
  return { data, height: side, width: side }
}

const invert = (frame: FrameImage): FrameImage => {
  const data = new Uint8ClampedArray(frame.data)
  for (let at = 0; at < data.length; at += 4) {
    data.fill(255 - (data[at] ?? 0), at, at + 3)
  }
  return { ...frame, data }
}

const blank = (): FrameImage => ({
  data: new Uint8ClampedArray(64 * 64 * 4).fill(255),
  height: 64,
  width: 64,
})

type Detect = () => Promise<{ rawValue: string }[]>

// Node has neither global, and the decoder only passes the frame through.
const stubDetector = (detect: Detect): void => {
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      detect = detect
    },
  )
  vi.stubGlobal('ImageData', Object)
}

describe(createFrameDecoder, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the real pass QR with the JS decoder when there is no BarcodeDetector', async () => {
    expect('BarcodeDetector' in globalThis).toBe(false)
    await expect(createFrameDecoder()(renderPassQr(6))).resolves.toMatch(PASS_QR)
  })

  it('still reads it at a few pixels per module, as from a phone screen across a desk', async () => {
    await expect(createFrameDecoder()(renderPassQr(3))).resolves.toMatch(PASS_QR)
  })

  it('does not look for a light-on-dark code, which fuda never draws', async () => {
    await expect(createFrameDecoder()(invert(renderPassQr(6)))).resolves.toBeNull()
  })

  it('finds nothing in a frame without a code', async () => {
    await expect(createFrameDecoder()(blank())).resolves.toBeNull()
  })

  it('uses the browser detector when it works and does not touch the JS decoder', async () => {
    const detect = vi.fn<Detect>().mockResolvedValue([{ rawValue: 'from-native' }])
    stubDetector(detect)
    await expect(createFrameDecoder()(blank())).resolves.toBe('from-native')
    expect(detect).toHaveBeenCalledOnce()
  })

  it('treats an empty native answer as no code', async () => {
    stubDetector(vi.fn<Detect>().mockResolvedValue([]))
    await expect(createFrameDecoder()(renderPassQr(6))).resolves.toBeNull()
  })

  it('drops a detector that rejects and reads with the JS decoder from then on', async () => {
    const detect = vi.fn<Detect>().mockRejectedValue(new Error('no backend'))
    stubDetector(detect)
    const decodeFrame = createFrameDecoder()
    await expect(decodeFrame(renderPassQr(6))).resolves.toMatch(PASS_QR)
    await expect(decodeFrame(renderPassQr(6))).resolves.toMatch(PASS_QR)
    expect(detect).toHaveBeenCalledOnce()
  })

  it('falls back when the constructor itself throws', async () => {
    // `new Symbol()` throws, like a detector constructor that rejects its options.
    vi.stubGlobal('BarcodeDetector', Symbol)
    await expect(createFrameDecoder()(renderPassQr(6))).resolves.toMatch(PASS_QR)
  })
})
