import { describe, expect, it } from 'vitest'

import { base64Decode, base64urlBytes, base64urlText } from './base64url.ts'

describe(base64urlBytes, () => {
  it('encodes bytes without padding and with the url alphabet', () => {
    // 0xfb 0xff encodes to "+/8=" in standard base64.
    expect(base64urlBytes(new Uint8Array([251, 255]))).toBe('-_8')
    expect(base64urlBytes(new Uint8Array([]))).toBe('')
  })

  it('round-trips every byte value through base64Decode', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) {
      bytes[i] = i
    }
    const std = btoa(String.fromCodePoint(...bytes))
    expect([...base64Decode(std)]).toStrictEqual([...bytes])
  })
})

describe(base64urlText, () => {
  it('encodes utf-8 text', () => {
    expect(base64urlText('{"alg":"RS256"}')).toBe('eyJhbGciOiJSUzI1NiJ9')
  })
})
