import type { GraphAttendance, GraphDelegation, GraphRight } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import { loadOnChainStatus } from './on-chain-status.ts'
import type { OnChainStatusIo } from './on-chain-status.ts'

const RIGHT_UID = `0x${'aa'.repeat(32)}` as const
const ISSUER = `0x${'22'.repeat(20)}` as const
const DELEGATION_UID = `0x${'bb'.repeat(32)}` as const
const delegation: GraphDelegation = {
  active: true,
  id: DELEGATION_UID,
  issuer: ISSUER,
  name: 'root',
  revokedAt: null,
}
const right: GraphRight = {
  delegation,
  holder: `0x${'11'.repeat(20)}`,
  id: RIGHT_UID,
  issuer: ISSUER,
  level: 1,
  metaURI: '',
  refUID: DELEGATION_UID,
  revokedAt: null,
  schemaVersion: 1,
  serial: `0x${'00'.repeat(32)}`,
  tier: 1,
  usageModel: 1,
  validFrom: 0n,
  validUntil: 0n,
}
const attendance: GraphAttendance = {
  enteredAt: 10n,
  holder: right.holder,
  id: `0x${'cc'.repeat(32)}`,
  rightUID: RIGHT_UID,
  slotId: `0x${'00'.repeat(32)}`,
  timestamp: 11n,
}

describe(loadOnChainStatus, () => {
  it('loads graph relations without consulting the D1 member API', async () => {
    const attendancesByRight = vi.fn<OnChainStatusIo['attendancesByRight']>(
      async () => await Promise.resolve([attendance]),
    )
    const delegationsByIssuer = vi.fn<OnChainStatusIo['delegationsByIssuer']>(
      async () => await Promise.resolve([delegation]),
    )
    const rightsByHolder = vi.fn<OnChainStatusIo['rightsByHolder']>(
      async () => await Promise.resolve([right]),
    )
    const io = {
      attendancesByRight,
      delegationsByIssuer,
      rightsByHolder,
    }

    const result = await loadOnChainStatus(io, 'https://graph.example/query', right.holder)

    expect(result).toStrictEqual({
      attendances: { [RIGHT_UID]: [attendance] },
      delegations: [delegation],
      rights: [right],
    })
    expect(rightsByHolder).toHaveBeenCalledWith('https://graph.example/query', right.holder)
    expect(attendancesByRight).toHaveBeenCalledWith('https://graph.example/query', RIGHT_UID)
    expect(delegationsByIssuer).toHaveBeenCalledWith('https://graph.example/query', ISSUER)
  })
})
