import { describe, expect, it } from 'vitest'

import { hasIssuer, signedOutSession, unauthorizedSession } from './app-state.ts'

describe(unauthorizedSession, () => {
  it('clears the token, the operator venue and protected rows on 401', () => {
    expect(
      unauthorizedSession({
        authError: null,
        members: { kind: 'ready', rows: [] },
        operator: { cards: [], ens: null, issuer: null, publicUrl: null },
        token: 'secret',
      }),
    ).toStrictEqual({
      authError: 'unauthorized',
      members: { kind: 'idle' },
      operator: null,
      token: null,
    })
  })
})

describe(hasIssuer, () => {
  it('is true only for an operator session that already has a venue', () => {
    expect(hasIssuer(signedOutSession())).toBe(false)
    expect(
      hasIssuer({ ...signedOutSession(), operator: { cards: [], ens: null, issuer: null, publicUrl: null } }),
    ).toBe(false)
  })
})
