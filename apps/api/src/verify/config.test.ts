import { describe, expect, it } from 'vitest'

import { FakeChain } from '../chain/fake-chain.ts'
import { SCHEMA_STRINGS, schemaUid } from '../eas/schemas.ts'
import type { Bindings } from '../env.ts'
import { verifyConfig } from './config.ts'

const ENT = schemaUid(SCHEMA_STRINGS.entitlement)
const DEL = schemaUid(SCHEMA_STRINGS.issuerDelegation)
const ISSUER = `0x${'f0'.repeat(20)}`

const bindings = (over: Partial<Bindings> = {}): Bindings =>
  ({
    EAS_SCHEMAS: JSON.stringify({
      attendance: [],
      entitlement: [{ uid: ENT, version: 1 }],
      issuerDelegation: [{ uid: DEL, version: 1 }],
    }),
    ISSUER_ADDRESS: ISSUER,
    ...over,
  }) as Bindings

describe(verifyConfig, () => {
  it('parses the accepted schema sets and carries the issuer address and clock', () => {
    const deps = verifyConfig(bindings(), new FakeChain(), 42)
    expect(deps.sets.entitlement).toStrictEqual([{ uid: ENT, version: 1 }])
    expect(deps.sets.issuerDelegation).toStrictEqual([{ uid: DEL, version: 1 }])
    expect(deps.issuerAddress).toBe(ISSUER)
    expect(deps.now).toBe(42)
  })

  it('falls back to the zero address when ISSUER_ADDRESS is missing or malformed', () => {
    const zero = `0x${'00'.repeat(20)}`
    expect(verifyConfig(bindings({ ISSUER_ADDRESS: '' }), new FakeChain(), 0).issuerAddress).toBe(zero)
    expect(verifyConfig(bindings({ ISSUER_ADDRESS: 'nope' }), new FakeChain(), 0).issuerAddress).toBe(zero)
  })
})
