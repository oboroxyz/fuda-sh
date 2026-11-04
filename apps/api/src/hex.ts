// Lowercase hex of a byte array. The gate's nonce and the session token hash
// both render bytes this way, so the encoder lives in one place.
export const bytesOfHex = (hex: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16))

export const toHex = (bytes: Uint8Array): string => {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}
