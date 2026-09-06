// base64url for the compact JWT: WebCrypto only, no Node Buffer, so the same
// code runs in workerd, the browser and node.

const toBinary = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) {
    s += String.fromCodePoint(b)
  }
  return s
}

export const base64urlBytes = (bytes: Uint8Array): string =>
  btoa(toBinary(bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

export const base64urlText = (text: string): string => base64urlBytes(new TextEncoder().encode(text))

// Standard base64 (the alphabet a PEM body uses), not base64url. The buffer is
// allocated explicitly so the result is `Uint8Array<ArrayBuffer>`: WebCrypto's
// BufferSource rejects the `ArrayBufferLike` that `Uint8Array.from` infers.
export const base64Decode = (b64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.codePointAt(i) ?? 0
  }
  return out
}
