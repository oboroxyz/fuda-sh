import { describe, expect, it } from 'vitest'

import { createSessionGeneration } from './session-generation.ts'

describe(createSessionGeneration, () => {
  it('invalidates every ticket from the previous session', () => {
    const generation = createSessionGeneration()
    const old = generation.capture()
    expect(generation.isCurrent(old)).toBe(true)
    generation.invalidate()
    expect(generation.isCurrent(old)).toBe(false)
    expect(generation.isCurrent(generation.capture())).toBe(true)
  })
})
