import { describe, expect, it } from 'vitest'

import { bindChunks, D1_MAX_BOUND_PARAMS } from './bind-chunks.ts'

const values = (count: number): number[] => Array.from({ length: count }, (_, i) => i)

describe(bindChunks, () => {
  it('splits a list longer than one statement into full batches plus the remainder', () => {
    const batches = bindChunks(values(250))
    expect(batches.map((batch) => batch.length)).toStrictEqual([100, 100, 50])
    expect(batches.flat()).toStrictEqual(values(250))
  })

  it('never exceeds the bound-parameter limit for a full members page', () => {
    const batches = bindChunks(values(200))
    expect(batches.every((batch) => batch.length <= D1_MAX_BOUND_PARAMS)).toBe(true)
  })

  it('yields no batch for an empty list, so the caller skips the query', () => {
    expect(bindChunks([])).toStrictEqual([])
  })

  it('leaves a list that fits in one statement as a single batch', () => {
    expect(bindChunks(values(100))).toStrictEqual([values(100)])
  })

  it('honours a smaller size for a statement that binds other placeholders too', () => {
    expect(bindChunks(values(5), 2)).toStrictEqual([[0, 1], [2, 3], [4]])
  })
})
