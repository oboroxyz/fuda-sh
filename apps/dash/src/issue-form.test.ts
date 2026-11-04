import { describe, expect, it } from 'vitest'

import { issueBodyFrom } from './issue-form.ts'

const base = { holder: '', memberId: '', tier: 1, usageModel: 1 }

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

  it('returns null when the identity field is empty', () => {
    expect(issueBodyFrom({ ...base, level: 'bearer' })).toBeNull()
  })

  it('carries the chosen tier and usage model', () => {
    expect(
      issueBodyFrom({ ...base, level: 'bearer', memberId: 'bob', tier: 3, usageModel: 0 }),
    ).toStrictEqual({ memberId: 'bob', tier: 3, usageModel: 0 })
  })
})
