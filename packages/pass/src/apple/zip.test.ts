import { describe, expect, it } from 'vitest'

import { crc32 } from './crc32.ts'
import { buildZip } from './zip.ts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const u32 = (zip: Uint8Array, at: number): number => new DataView(zip.buffer).getUint32(at, true)

const u16 = (zip: Uint8Array, at: number): number => new DataView(zip.buffer).getUint16(at, true)

describe(crc32, () => {
  it('matches the reference CRC-32 of "abc" and of the empty input', () => {
    expect(crc32(bytes('abc'))).toBe(0x35_24_41_c2)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe(buildZip, () => {
  it('lays out a local header, the central directory and the end record', () => {
    const zip = buildZip([{ data: bytes('abc'), name: 'a.txt' }])
    expect(u32(zip, 0)).toBe(0x04_03_4b_50)
    expect(u16(zip, 8)).toBe(0)
    expect(u32(zip, 14)).toBe(0x35_24_41_c2)
    // 30-byte header + 5-byte name + 3 bytes of data, then the central entry.
    expect(u32(zip, 38)).toBe(0x02_01_4b_50)
    expect(zip).toHaveLength(38 + 46 + 5 + 22)
  })

  it('stores both entries uncompressed with their sizes in the local header', () => {
    const zip = buildZip([
      { data: bytes('abc'), name: 'a.txt' },
      { data: bytes('hello'), name: 'b.bin' },
    ])
    expect(u16(zip, 8)).toBe(0)
    expect(u32(zip, 18)).toBe(3)
    expect(u32(zip, 22)).toBe(3)
    // The second entry begins right after the first: 30 + 5 + 3.
    expect(u32(zip, 38)).toBe(0x04_03_4b_50)
    expect(u32(zip, 38 + 18)).toBe(5)
  })

  it('records every entry once in the end record, pointing at the directory', () => {
    const zip = buildZip([
      { data: bytes('abc'), name: 'a.txt' },
      { data: bytes('hello'), name: 'b.bin' },
    ])
    const end = zip.length - 22
    expect(u32(zip, end)).toBe(0x06_05_4b_50)
    expect(u16(zip, end + 8)).toBe(2)
    expect(u16(zip, end + 10)).toBe(2)
    const centralStart = u32(zip, end + 16)
    expect(u32(zip, centralStart)).toBe(0x02_01_4b_50)
    expect(u32(zip, end + 12)).toBe(end - centralStart)
  })

  it('points each central entry at its local header offset', () => {
    const zip = buildZip([
      { data: bytes('abc'), name: 'a.txt' },
      { data: bytes('hello'), name: 'b.bin' },
    ])
    const centralStart = u32(zip, zip.length - 22 + 16)
    expect(u32(zip, centralStart + 42)).toBe(0)
    expect(u32(zip, centralStart + 46 + 5 + 42)).toBe(38)
  })

  it('writes the file names and the payloads verbatim', () => {
    const zip = buildZip([{ data: bytes('abc'), name: 'a.txt' }])
    const decoder = new TextDecoder()
    expect(decoder.decode(zip.slice(30, 35))).toBe('a.txt')
    expect(decoder.decode(zip.slice(35, 38))).toBe('abc')
  })
})
