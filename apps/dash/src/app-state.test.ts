import { describe, expect, it } from 'vitest'

import { unauthorizedSession } from './app-state.ts'

describe(unauthorizedSession, () => {
  it('clears only protected operational state on 401', () => {
    expect(
      unauthorizedSession({ authError: null, members: { kind: 'ready', rows: [] }, token: 'secret' }),
    ).toStrictEqual({ authError: 'unauthorized', members: { kind: 'idle' }, token: null })
  })
})
