import type { GraphRight } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { RightsListView } from './RightsList.tsx'

const RIGHT = `0x${'aa'.repeat(32)}` as const
const DELEGATION = `0x${'bb'.repeat(32)}` as const

interface ViewNode {
  props: { children?: unknown; class?: unknown; href?: unknown }
}

const isViewNode = (value: unknown): value is ViewNode => {
  if (typeof value !== 'object' || value === null || !('props' in value)) {
    return false
  }
  const { props } = value
  return typeof props === 'object' && props !== null
}

const viewNodes = (value: unknown): ViewNode[] => {
  if (Array.isArray(value)) {
    return value.flatMap(viewNodes)
  }
  return isViewNode(value) ? [value, ...viewNodes(value.props.children)] : []
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

const right = (id: `0x${string}`, revokedAt: bigint | null): GraphRight => ({
  delegation: {
    active: revokedAt === null,
    id: DELEGATION,
    issuer: `0x${'22'.repeat(20)}`,
    name: 'fuda root',
    revokedAt,
  },
  holder: `0x${'11'.repeat(20)}`,
  id,
  issuer: `0x${'22'.repeat(20)}`,
  level: 1,
  metaURI: 'ipfs://right',
  refUID: DELEGATION,
  revokedAt,
  schemaVersion: 1,
  serial: `0x${'00'.repeat(32)}`,
  tier: 2,
  usageModel: 1,
  validFrom: 0n,
  validUntil: 999n,
})

describe(RightsListView, () => {
  it('renders separate active and revoked right cards', () => {
    const view = RightsListView({
      state: { kind: 'ready', rights: [right(RIGHT, null), right(`0x${'cc'.repeat(32)}`, 88n)] },
    })
    const text = viewText(view)
    expect(viewNodes(view).filter(({ props }) => props.class === 'card bg-base-200')).toHaveLength(2)
    expect(text).toContain('ACTIVE')
    expect(text).toContain('REVOKED')
    expect(text).toContain(RIGHT)
    expect(text).toContain('ipfs://right')
  })

  it('renders explicit loading, empty, and error states', () => {
    expect(viewText(RightsListView({ state: { kind: 'loading' } }))).toContain('Loading rights')
    expect(viewText(RightsListView({ state: { kind: 'ready', rights: [] } }))).toContain('No rights found')
    expect(viewText(RightsListView({ state: { kind: 'error', message: 'Graph unavailable' } }))).toContain(
      'Graph unavailable',
    )
  })

  it('displays an unsafe metadata URI without making it a link', () => {
    const unsafe = { ...right(RIGHT, null), metaURI: ['javascript', 'alert(1)'].join(':') }
    const view = RightsListView({ state: { kind: 'ready', rights: [unsafe] } })

    expect(viewText(view)).toContain(unsafe.metaURI)
    expect(viewNodes(view).some(({ props }) => props.href === unsafe.metaURI)).toBe(false)
  })
})
