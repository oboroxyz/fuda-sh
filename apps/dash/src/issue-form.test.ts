import { describe, expect, it } from 'vitest'

import { issueBodyFrom } from './issue-form.ts'

const base = { holder: '', memberId: '', stealthMetaAddress: '', tier: 1, usageModel: 1 }

describe(issueBodyFrom, () => {
  it('sends only memberId for a Bearer right', () => {
    expect(issueBodyFrom({ ...base, level: 'bearer', memberId: ' alice ' })).toStrictEqual({
      memberId: 'alice',
      tier: 1,
      usageModel: 1,
    })
  })

  it('sends only holder for a Signed right', () => {
    const holder = `0x${'11'.repeat(20)}`
    expect(issueBodyFrom({ ...base, holder, level: 'signed' })).toStrictEqual({
      holder,
      tier: 1,
      usageModel: 1,
    })
  })

  it('rejects a malformed holder address', () => {
    expect(issueBodyFrom({ ...base, holder: '0x11', level: 'signed' })).toBeNull()
  })

  it('sends the meta-address for a +Private right', () => {
    const meta = `0x${'22'.repeat(66)}`
    expect(issueBodyFrom({ ...base, level: 'private', stealthMetaAddress: meta })).toStrictEqual({
      stealthMetaAddress: meta,
      tier: 1,
      usageModel: 1,
    })
  })

  it('adds the optional memberId to a +Private right', () => {
    const meta = `0x${'22'.repeat(66)}`
    expect(
      issueBodyFrom({ ...base, level: 'private', memberId: 'rep', stealthMetaAddress: meta }),
    ).toMatchObject({ memberId: 'rep' })
  })

  it('rejects a malformed meta-address', () => {
    expect(issueBodyFrom({ ...base, level: 'private', stealthMetaAddress: '0x22' })).toBeNull()
  })

  it('returns null when the identity field is empty', () => {
    expect(issueBodyFrom({ ...base, level: 'bearer' })).toBeNull()
  })

  it('carries the chosen tier and usage model', () => {
    expect(
      issueBodyFrom({ ...base, level: 'bearer', memberId: 'bob', tier: 3, usageModel: 0 }),
    ).toStrictEqual({ memberId: 'bob', tier: 3, usageModel: 0 })
  })
})
