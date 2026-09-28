import { describe, expect, it } from 'vitest'

import { EMPTY_WEDGE, wedgeKey } from './wedge.ts'
import type { WedgeState } from './wedge.ts'

// A scanner's keystrokes arrive a few milliseconds apart.
const typeInto = (text: string): WedgeState => {
  let state = EMPTY_WEDGE
  let now = 1000
  for (const key of text) {
    now += 5
    state = wedgeKey(state, key, now).next
  }
  return state
}

describe(wedgeKey, () => {
  it('accumulates a burst of keys', () => {
    expect(typeInto('fuda:v1:0xab').text).toBe('fuda:v1:0xab')
  })

  it('completes on Enter and hands back the payload', () => {
    const step = wedgeKey({ at: 1000, text: 'fuda:v1:0xab' }, 'Enter', 1050)
    expect(step.done).toBe('fuda:v1:0xab')
    expect(step.next).toStrictEqual(EMPTY_WEDGE)
  })

  it('reports nothing for a bare Enter, so a tap on the verdict still dismisses it', () => {
    expect(wedgeKey(EMPTY_WEDGE, 'Enter', 1050).done).toBeNull()
  })

  it('ignores modifier and navigation keys rather than buffering their names', () => {
    const state = { at: 1000, text: '0x' }
    expect(wedgeKey(state, 'Shift', 1010).next).toStrictEqual(state)
    expect(wedgeKey(state, 'ArrowLeft', 1010).next).toStrictEqual(state)
  })

  it('clears on Escape', () => {
    expect(wedgeKey({ at: 1000, text: '0x' }, 'Escape', 1010).next).toStrictEqual(EMPTY_WEDGE)
  })

  it('starts over after a long gap, so a stray keypress never prefixes a scan', () => {
    expect(wedgeKey({ at: 1000, text: 'x' }, 'f', 9000).next.text).toBe('f')
  })
})
