/* oxlint-disable no-bitwise -- CRC-32 is defined as a bitwise algorithm (ISO 3309 polynomial 0xEDB88320); every operator below is the specification, not a micro-optimization */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

// The checksum every ZIP entry header carries.
export const crc32 = (bytes: Uint8Array): number => {
  let c = 0xff_ff_ff_ff
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  }
  return (c ^ 0xff_ff_ff_ff) >>> 0
}
