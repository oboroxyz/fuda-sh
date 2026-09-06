import { describe, expect, it } from 'vitest'

import { findVersion, newest, parseSchemaSets, SCHEMA_STRINGS, schemaUid } from './schemas.ts'

describe(schemaUid, () => {
  it('is keccak256(encodePacked(string, address(0), true)) and stable', () => {
    const a = schemaUid(SCHEMA_STRINGS.entitlement)
    expect(a).toMatch(/^0x[0-9a-f]{64}$/u)
    expect(schemaUid(SCHEMA_STRINGS.entitlement)).toBe(a)
    expect(schemaUid(SCHEMA_STRINGS.attendance)).not.toBe(a)
  })
})

describe(parseSchemaSets, () => {
  const json = JSON.stringify({
    attendance: [{ uid: `0x${'cc'.repeat(32)}`, version: 1 }],
    entitlement: [{ uid: `0x${'aa'.repeat(32)}`, version: 1 }],
    issuerDelegation: [
      { uid: `0x${'bb'.repeat(32)}`, version: 1 },
      { uid: `0x${'bc'.repeat(32)}`, version: 2 },
    ],
  })

  it('parses and looks up by uid; unknown uid → null; newest picks the highest version', () => {
    const sets = parseSchemaSets(json)
    expect(findVersion(sets.entitlement, `0x${'aa'.repeat(32)}`)?.version).toBe(1)
    expect(findVersion(sets.entitlement, `0x${'ff'.repeat(32)}`)).toBeNull()
    expect(newest(sets.issuerDelegation)?.version).toBe(2)
    expect(newest([])).toBeNull()
  })

  it('rejects malformed config', () => {
    expect(() => parseSchemaSets('{}')).toThrow(/./u)
    expect(() => parseSchemaSets('nope')).toThrow(/./u)
  })
})
