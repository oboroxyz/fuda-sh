import { describe, expect, it } from 'vitest'

import { pemToDer } from './pem.ts'

const DER = new Uint8Array([1, 2, 3, 4])
const BODY = btoa(String.fromCodePoint(...DER))
const REAL_NEWLINES = `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----\n`

describe(pemToDer, () => {
  it('decodes a PEM block written with real newlines', () => {
    expect([...pemToDer(REAL_NEWLINES, 'PRIVATE KEY')]).toStrictEqual([...DER])
  })

  // What `wrangler secret put` receives when the value is copied straight out
  // of a service-account JSON: the newlines are still backslash-n escapes.
  it('decodes a PEM block written with literal backslash-n escapes', () => {
    const escaped = REAL_NEWLINES.replaceAll('\n', String.raw`\n`)
    expect([...pemToDer(escaped, 'PRIVATE KEY')]).toStrictEqual([...DER])
  })

  it('rejects a value that is not a PEM block of the expected label', () => {
    expect(() => pemToDer('not a key', 'PRIVATE KEY')).toThrow(/malformed PEM/u)
    expect(() => pemToDer('-----BEGIN PRIVATE KEY----------END PRIVATE KEY-----', 'PRIVATE KEY')).toThrow(
      /malformed PEM/u,
    )
    expect(() => pemToDer(REAL_NEWLINES, 'CERTIFICATE')).toThrow(/malformed PEM/u)
  })
})
