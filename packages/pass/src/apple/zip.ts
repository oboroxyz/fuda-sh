import { crc32 } from './crc32.ts'

// A minimal stored-only (method 0) ZIP writer. A .pkpass must not be
// compressed beyond what Wallet accepts, and workerd has no zlib, so entries
// go in uncompressed and the archive is written by hand: local file header per
// entry, then the central directory, then the end-of-central-directory record.

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const LOCAL_SIGNATURE = 0x04_03_4b_50
const CENTRAL_SIGNATURE = 0x02_01_4b_50
const END_SIGNATURE = 0x06_05_4b_50
const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const END_RECORD_SIZE = 22
// 2.0: the floor for a plain archive; nothing here needs a later feature.
const VERSION = 20

interface Prepared {
  name: Uint8Array
  data: Uint8Array
  crc: number
  offset: number
}

// The DOS time/date fields are left at 0: a pass carries no meaningful file
// timestamps, and a fixed value keeps the archive byte-identical per input.
const writeLocalHeader = (view: DataView, at: number, entry: Prepared): void => {
  view.setUint32(at, LOCAL_SIGNATURE, true)
  view.setUint16(at + 4, VERSION, true)
  view.setUint16(at + 6, 0, true)
  view.setUint16(at + 8, 0, true)
  view.setUint16(at + 10, 0, true)
  view.setUint16(at + 12, 0, true)
  view.setUint32(at + 14, entry.crc, true)
  view.setUint32(at + 18, entry.data.length, true)
  view.setUint32(at + 22, entry.data.length, true)
  view.setUint16(at + 26, entry.name.length, true)
  view.setUint16(at + 28, 0, true)
}

const writeCentralHeader = (view: DataView, at: number, entry: Prepared): void => {
  view.setUint32(at, CENTRAL_SIGNATURE, true)
  view.setUint16(at + 4, VERSION, true)
  view.setUint16(at + 6, VERSION, true)
  view.setUint16(at + 8, 0, true)
  view.setUint16(at + 10, 0, true)
  view.setUint16(at + 12, 0, true)
  view.setUint16(at + 14, 0, true)
  view.setUint32(at + 16, entry.crc, true)
  view.setUint32(at + 20, entry.data.length, true)
  view.setUint32(at + 24, entry.data.length, true)
  view.setUint16(at + 28, entry.name.length, true)
  view.setUint16(at + 30, 0, true)
  view.setUint16(at + 32, 0, true)
  view.setUint16(at + 34, 0, true)
  view.setUint16(at + 36, 0, true)
  view.setUint32(at + 38, 0, true)
  view.setUint32(at + 42, entry.offset, true)
}

export const buildZip = (entries: ZipEntry[]): Uint8Array<ArrayBuffer> => {
  const encoder = new TextEncoder()
  const prepared: Prepared[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    prepared.push({ crc: crc32(entry.data), data: entry.data, name, offset })
    offset += LOCAL_HEADER_SIZE + name.length + entry.data.length
  }
  const centralStart = offset
  const centralSize = prepared.reduce((sum, e) => sum + CENTRAL_HEADER_SIZE + e.name.length, 0)
  const out = new Uint8Array(new ArrayBuffer(centralStart + centralSize + END_RECORD_SIZE))
  const view = new DataView(out.buffer)
  for (const entry of prepared) {
    writeLocalHeader(view, entry.offset, entry)
    out.set(entry.name, entry.offset + LOCAL_HEADER_SIZE)
    out.set(entry.data, entry.offset + LOCAL_HEADER_SIZE + entry.name.length)
  }
  let at = centralStart
  for (const entry of prepared) {
    writeCentralHeader(view, at, entry)
    out.set(entry.name, at + CENTRAL_HEADER_SIZE)
    at += CENTRAL_HEADER_SIZE + entry.name.length
  }
  view.setUint32(at, END_SIGNATURE, true)
  view.setUint16(at + 4, 0, true)
  view.setUint16(at + 6, 0, true)
  view.setUint16(at + 8, prepared.length, true)
  view.setUint16(at + 10, prepared.length, true)
  view.setUint32(at + 12, centralSize, true)
  view.setUint32(at + 16, centralStart, true)
  view.setUint16(at + 20, 0, true)
  return out
}
