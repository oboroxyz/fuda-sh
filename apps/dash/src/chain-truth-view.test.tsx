import type { GraphAttendance, GraphDelegation, GraphRight } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { ChainTruthView } from './ChainTruth.tsx'

const RIGHT_UID = `0x${'aa'.repeat(32)}` as const
const DELEGATION_UID = `0x${'bb'.repeat(32)}` as const

interface ViewNode {
  props: { children?: unknown }
}

const isViewNode = (value: unknown): value is ViewNode => {
  if (typeof value !== 'object' || value === null || !('props' in value)) {
    return false
  }
  const { props } = value
  return typeof props === 'object' && props !== null
}

const isTextChild = (value: unknown): value is bigint | number | string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'

const viewText = (value: unknown): string => {
  if (isTextChild(value)) {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(viewText).join(' ')
  }
  return isViewNode(value) ? viewText(value.props.children) : ''
}

const delegation: GraphDelegation = {
  active: true,
  id: DELEGATION_UID,
  issuer: `0x${'22'.repeat(20)}`,
  name: 'root',
  revokedAt: null,
}
const right: GraphRight = {
  delegation,
  holder: `0x${'11'.repeat(20)}`,
  id: RIGHT_UID,
  issuer: delegation.issuer,
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
  enteredAt: 55n,
  holder: right.holder,
  id: `0x${'cc'.repeat(32)}`,
  rightUID: RIGHT_UID,
  slotId: `0x${'00'.repeat(32)}`,
  timestamp: 56n,
}

describe(ChainTruthView, () => {
  it('renders a right whose delegation is unresolved without hiding the other rights', () => {
    const text = viewText(
      ChainTruthView({
        state: {
          attendances: {},
          delegations: [delegation],
          kind: 'ready',
          rights: [{ ...right, delegation: null, refUID: DELEGATION_UID }, right],
        },
      }),
    ).replaceAll(/\s+/gu, ' ')

    expect(text).toContain(`Unresolved delegation ${DELEGATION_UID}`)
    expect(text).toContain(`delegation ${DELEGATION_UID}`)
    expect(text).toContain(RIGHT_UID)
  })

  it('renders chain rights, delegations, and attendance without a D1 member row', () => {
    const text = viewText(
      ChainTruthView({
        state: {
          attendances: { [RIGHT_UID]: [attendance] },
          delegations: [delegation],
          kind: 'ready',
          rights: [right],
        },
      }),
    ).replaceAll(/\s+/gu, ' ')
    expect(text).toContain(`Chain truth ${RIGHT_UID}`)
    expect(text).toContain(DELEGATION_UID)
    expect(text).toContain('ACTIVE root')
    expect(text).toContain('entered at 55')
    expect(text).not.toContain('member')
  })

  it('renders explicit loading, empty, and error states', () => {
    expect(viewText(ChainTruthView({ state: { kind: 'loading' } }))).toContain('Loading chain truth')
    expect(
      viewText(ChainTruthView({ state: { attendances: {}, delegations: [], kind: 'ready', rights: [] } })),
    ).toContain('No on-chain rights found')
    expect(viewText(ChainTruthView({ state: { kind: 'error', message: 'Graph unavailable' } }))).toContain(
      'Graph unavailable',
    )
  })
})
