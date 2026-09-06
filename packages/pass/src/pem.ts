import { base64Decode } from './base64url.ts'

// Accepts a PEM block as pasted into a Worker secret: real newlines or the
// literal "\n" escapes a service-account JSON carries. Returns the DER bytes.
export const pemToDer = (pem: string, label: string): Uint8Array<ArrayBuffer> => {
  const normalized = pem.replaceAll(String.raw`\n`, '\n')
  const body = normalized
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replaceAll(/\s+/gu, '')
  if (body === '' || !normalized.includes(`-----BEGIN ${label}-----`)) {
    throw new Error(`malformed PEM: expected a ${label} block`)
  }
  return base64Decode(body)
}
