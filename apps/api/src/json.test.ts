import { describe, expect, it } from 'vitest'

import { toJsonSafe } from './json.ts'

describe(toJsonSafe, () => {
  it('converts safe bigints to numbers and huge ones to strings, recursively', () => {
    const out = toJsonSafe({ a: 1n, b: [2n, { c: 2n ** 60n }], d: 'x', e: null })
    expect(out).toStrictEqual({ a: 1, b: [2, { c: (2n ** 60n).toString() }], d: 'x', e: null })
    expect(JSON.stringify(out)).toContain('"a":1')
  })
})
