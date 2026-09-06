import type { GraphAttendance, GraphDelegation, GraphRight } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { OnChainStatusView } from './OnChainStatus.tsx'
import { walkView } from './test/test-view.ts'

const copy = DASH_COPY.ja.chain

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

describe(OnChainStatusView, () => {
  it('renders a right whose delegation is unresolved without hiding the other rights', () => {
    const text = viewText(
      OnChainStatusView({
        copy,
        state: {
          attendances: {},
          delegations: [delegation],
          kind: 'ready',
          rights: [{ ...right, delegation: null, refUID: DELEGATION_UID }, right],
        },
      }),
    ).replaceAll(/\s+/gu, ' ')

    expect(text).toContain(`未解決の委任 ${DELEGATION_UID}`)
    expect(text).toContain(`委任 ${DELEGATION_UID}`)
    expect(text).toContain(RIGHT_UID)
  })

  it('marks resolved and unresolved delegation identifiers for wrapping on narrow screens', () => {
    const view = OnChainStatusView({
      copy,
      state: {
        attendances: {},
        delegations: [],
        kind: 'ready',
        rights: [{ ...right, delegation: null }, right],
      },
    })
    const references = walkView(view).filter((node) => node.props.class === 'dash-chain-reference')
    expect(references.map(viewText)).toStrictEqual([
      `未解決の委任 ${DELEGATION_UID}`,
      `委任 ${DELEGATION_UID}`,
    ])
  })

  it('wraps an unbroken 80-character name on the populated delegation container', () => {
    const name = 'a'.repeat(80)
    const view = OnChainStatusView({
      copy: DASH_COPY.en.chain,
      state: {
        attendances: { [RIGHT_UID]: [attendance] },
        delegations: [{ ...delegation, name }],
        kind: 'ready',
        rights: [right],
      },
    })
    const nameContainer = walkView(view).find((node) => node.props.children === `ACTIVE ${name}`)

    expect(nameContainer?.props.class).toBe('dash-chain-name')
    expect(viewText(view)).toContain('Entered at 55')
  })

  it('renders chain rights, delegations, and attendance without a D1 member row', () => {
    const text = viewText(
      OnChainStatusView({
        copy,
        state: {
          attendances: { [RIGHT_UID]: [attendance] },
          delegations: [delegation],
          kind: 'ready',
          rights: [right],
        },
      }),
    ).replaceAll(/\s+/gu, ' ')
    expect(text).toContain(`オンチェーン権利 ${RIGHT_UID}`)
    expect(text).toContain(DELEGATION_UID)
    expect(text).toContain('有効 root')
    expect(text).toContain('入場日時 55')
    expect(text).not.toContain('member')
  })

  it('renders explicit loading, empty, and error states', () => {
    expect(viewText(OnChainStatusView({ copy, state: { kind: 'idle' } }))).toContain('保有者を入力')
    expect(viewText(OnChainStatusView({ copy, state: { kind: 'loading' } }))).toContain('読み込み中')
    expect(
      viewText(
        OnChainStatusView({ copy, state: { attendances: {}, delegations: [], kind: 'ready', rights: [] } }),
      ),
    ).toContain('オンチェーン権利が見つかりません')
    expect(
      viewText(OnChainStatusView({ copy, state: { kind: 'error', message: 'Graph unavailable' } })),
    ).toContain('Graph unavailable')
  })

  it('keeps error details verbatim inside a localized alert', () => {
    const view = OnChainStatusView({ copy, state: { kind: 'error', message: 'GRAPH_TIMEOUT [42]' } })
    expect(viewText(view)).toContain('チェーン検索に失敗しました。')
    expect(viewText(view)).toContain('GRAPH_TIMEOUT [42]')
    expect(walkView(view).some((node) => node.props.role === 'alert')).toBe(true)
  })

  it('keeps external text that matches translated copy as raw details', () => {
    const state = { kind: 'error', message: 'Chain lookup failed.' } as const
    expect(viewText(OnChainStatusView({ copy: DASH_COPY.en.chain, state }))).toBe(
      'Chain lookup failed. Chain lookup failed.',
    )
    expect(viewText(OnChainStatusView({ copy, state }))).toBe(
      'チェーン検索に失敗しました。 Chain lookup failed.',
    )
  })

  it('renders revoked BigInt timestamps and inactive delegations as strings', () => {
    const view = OnChainStatusView({
      copy,
      state: {
        attendances: { [RIGHT_UID]: [attendance] },
        delegations: [
          { ...delegation, revokedAt: 99n },
          { ...delegation, active: false },
        ],
        kind: 'ready',
        rights: [{ ...right, revokedAt: 88n }],
      },
    })
    expect(viewText(view)).toContain('取り消し日時 88')
    expect(viewText(view)).toContain('取り消し日時 99 root')
    expect(viewText(view)).toContain('無効 root')
    const children = new Set(walkView(view).map((node) => node.props.children))
    expect([55n, 88n, 99n].filter((timestamp) => children.has(timestamp))).toStrictEqual([])
  })
})
