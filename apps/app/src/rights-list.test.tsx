import type { GraphRight, Hex, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/ui'
import { describe, expect, it, vi } from 'vitest'

import {
  applePassAvailable,
  googlePassHref,
  loadMemberPassList,
  rememberQueryPass,
  refreshPassStatuses,
  withConnectedAddress,
} from './member-pass-list.ts'
import type { MemberPassListIo, MemberPassRow } from './member-pass-list.ts'
import { RightsList, RightsListView } from './RightsList.tsx'

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

const HOLDER_A: Hex = `0x${'11'.repeat(20)}`
const HOLDER_B: Hex = `0x${'33'.repeat(20)}`
const UID_B: Hex = `0x${'bb'.repeat(32)}`
const UID_C: Hex = `0x${'cc'.repeat(32)}`

const admitted = (holder: Hex): Result<VerifyResponse> => ({
  body: {
    decision: 'ADMIT',
    entitlement: {
      holder,
      issuer: `0x${'22'.repeat(20)}`,
      level: 1,
      schemaVersion: 1,
      tier: 2,
      usageModel: 1,
      validFrom: 0,
      validUntil: 999,
    },
    reason: 'OK',
  },
  ok: true,
})

const memberIo = (fetchRights: MemberPassListIo['fetchRights']): MemberPassListIo => ({
  appleAvailable: async () => await Promise.resolve(false),
  fetchRights,
  googleHref: async () => await Promise.resolve(null),
  verify: async (uid) => await Promise.resolve(admitted(uid === UID_C ? HOLDER_B : HOLDER_A)),
})

const memberRow = (overrides: Partial<MemberPassRow>): MemberPassRow => ({
  appleHref: null,
  googleHref: null,
  graph: null,
  memory: null,
  passes: {
    apple: `http://localhost:8787/pass/${RIGHT}/apple.pkpass`,
    google: `http://localhost:8787/pass/${RIGHT}/google`,
    web: `http://localhost:8787/pass/${RIGHT}`,
  },
  preview: { decision: 'ADMIT', reason: 'OK' },
  uid: RIGHT,
  ...overrides,
})

describe(loadMemberPassList, () => {
  it('unions case-insensitive holders and uid rows without duplicate Graph queries', async () => {
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(
      async (holder) =>
        await Promise.resolve(
          holder.toLowerCase() === HOLDER_A.toLowerCase() ? [right(RIGHT, null)] : [right(UID_B, null)],
        ),
    )

    const result = await loadMemberPassList(
      {
        addresses: [HOLDER_A, HOLDER_A.toLowerCase() as Hex, HOLDER_B],
        graphConfigured: true,
        memory: [
          { addedAt: 20, holder: HOLDER_A, uid: RIGHT },
          { addedAt: 10, holder: HOLDER_B, uid: UID_C },
        ],
      },
      memberIo(fetchRights),
    )

    expect(fetchRights).toHaveBeenCalledTimes(2)
    expect(result.indexUnavailable).toBe(false)
    expect(result.rows.map(({ uid }) => uid)).toStrictEqual([RIGHT, UID_C, UID_B])
  })

  it('keeps successful Graph and memory rows when another holder query rejects', async () => {
    const result = await loadMemberPassList(
      {
        addresses: [HOLDER_A, HOLDER_B],
        graphConfigured: true,
        memory: [{ addedAt: 1, holder: HOLDER_B, uid: UID_C }],
      },
      memberIo(async (holder) => {
        if (holder === HOLDER_A) {
          return await Promise.resolve([right(RIGHT, null)])
        }
        return await Promise.reject(new Error('Graph offline'))
      }),
    )

    expect(result.rows.map(({ uid }) => uid)).toStrictEqual([UID_C, RIGHT])
    expect(result.indexUnavailable).toBe(true)
  })

  it('does not query Graph and marks the index unavailable when no endpoint is configured', async () => {
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(async () => await Promise.resolve([]))

    const result = await loadMemberPassList(
      {
        addresses: [HOLDER_A],
        graphConfigured: false,
        memory: [{ addedAt: 1, holder: HOLDER_A, uid: UID_C }],
      },
      memberIo(fetchRights),
    )

    expect(fetchRights).not.toHaveBeenCalled()
    expect(result.indexUnavailable).toBe(true)
    expect(result.rows.map(({ uid }) => uid)).toStrictEqual([UID_C])
  })
})

describe('pass link availability', () => {
  it('keeps the web pass URL and shows platform links only when their probes succeed', async () => {
    const google = 'https://wallet.google.test/save'
    const result = await loadMemberPassList(
      { addresses: [], graphConfigured: false, memory: [{ addedAt: 1, holder: HOLDER_A, uid: RIGHT }] },
      {
        appleAvailable: async () => await Promise.resolve(true),
        fetchRights: async () => await Promise.resolve([]),
        googleHref: async () => await Promise.resolve(google),
        verify: async () => await Promise.resolve(admitted(HOLDER_A)),
      },
    )

    expect(result.rows[0]).toMatchObject({
      appleHref: `http://localhost:8787/pass/${RIGHT}/apple.pkpass`,
      googleHref: google,
    })
    expect(result.rows[0]?.passes.web).toBe(`http://localhost:8787/pass/${RIGHT}`)
  })

  it('hides Google after 501, bad responses, malformed JSON, and transport errors', async () => {
    const failures = [
      async () => await Promise.resolve(new Response(null, { status: 501 })),
      async () => await Promise.resolve(new Response(null, { status: 503 })),
      async () => await Promise.resolve(Response.json({ nope: 'missing save URL' })),
      async () => await Promise.reject(new Error('offline')),
    ]

    await expect(
      Promise.all(failures.map(async (request) => await googlePassHref('https://api.test/google', request))),
    ).resolves.toStrictEqual([null, null, null, null])
  })

  it('hides Apple after 501, other non-2xx responses, and transport errors', async () => {
    const failures = [
      async () => await Promise.resolve(new Response(null, { status: 501 })),
      async () => await Promise.resolve(new Response(null, { status: 503 })),
      async () => await Promise.reject(new Error('offline')),
    ]

    await expect(
      Promise.all(
        failures.map(async (request) => await applePassAvailable('https://api.test/apple', request)),
      ),
    ).resolves.toStrictEqual([false, false, false])
  })

  it('uses the returned Google saveUrl and a successful Apple HEAD response', async () => {
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async (_url, init) =>
        await Promise.resolve(
          init?.method === 'HEAD'
            ? new Response(null, { status: 204 })
            : Response.json({ saveUrl: 'https://pay.google.com/gp/v/save' }),
        ),
    )

    await expect(googlePassHref('https://api.test/google', request)).resolves.toBe(
      'https://pay.google.com/gp/v/save',
    )
    await expect(applePassAvailable('https://api.test/apple', request)).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith('https://api.test/apple', { method: 'HEAD' })
  })
})

describe(refreshPassStatuses, () => {
  it('replaces stale status from verify without re-querying Graph', async () => {
    const stale: MemberPassRow = {
      appleHref: null,
      googleHref: null,
      graph: right(RIGHT, null),
      memory: null,
      passes: {
        apple: `http://localhost:8787/pass/${RIGHT}/apple.pkpass`,
        google: `http://localhost:8787/pass/${RIGHT}/google`,
        web: `http://localhost:8787/pass/${RIGHT}`,
      },
      preview: { decision: 'ADMIT', reason: 'OK' },
      uid: RIGHT,
    }
    const verify = vi.fn<MemberPassListIo['verify']>(
      async () => await Promise.resolve({ body: { decision: 'REJECT', reason: 'REVOKED' }, ok: true }),
    )

    const refreshed = await refreshPassStatuses([stale], verify)

    expect(refreshed[0]?.preview).toStrictEqual({ decision: 'REJECT', reason: 'REVOKED' })
    expect(verify).toHaveBeenCalledOnce()
  })
})

describe('member pass screen', () => {
  it('introduces the member list rails, +Private link, manual disclosure, and empty discovery paths', () => {
    const view = RightsList({ injected: { request: async () => await Promise.resolve([HOLDER_A]) } })
    const text = viewText(view)

    expect(text).toMatch(
      /^(?=.*Your passes)(?=.*Connect passkey)(?=.*Use wallet)(?=.*Private rights →)(?=.*saved on this device)(?=.*\+Private)/u,
    )
    expect(viewNodes(view).some(({ props }) => props.href === '/private')).toBe(true)
    expect(viewNodes(view).some(({ props }) => props.children === 'Look up another address')).toBe(true)
  })
})

describe('member rails and query memory', () => {
  it('adds an injected or passkey account to the next address union without a signature', async () => {
    const passkeyAddress = await Promise.resolve(HOLDER_A)
    const walletAddress = await Promise.resolve(HOLDER_B)
    const connected = withConnectedAddress(withConnectedAddress([], passkeyAddress), walletAddress)
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(async () => await Promise.resolve([]))

    await loadMemberPassList(
      { addresses: connected, graphConfigured: true, memory: [] },
      memberIo(fetchRights),
    )

    expect(fetchRights).toHaveBeenCalledWith(HOLDER_A)
    expect(fetchRights).toHaveBeenCalledWith(HOLDER_B)
  })

  it('turns a /rights uid preview into remembered holder memory', async () => {
    const remembered: { holder: Hex; uid: Hex }[] = []
    const entry = await rememberQueryPass(
      RIGHT,
      async () => await Promise.resolve(admitted(HOLDER_A)),
      (pass) => {
        remembered.push(pass)
      },
    )

    expect(entry).toMatchObject({ holder: HOLDER_A, uid: RIGHT })
    expect(remembered).toStrictEqual([{ holder: HOLDER_A, uid: RIGHT }])
  })
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

  it('uses a live REVOKED preview over an active Graph row and tags memory-only rows', () => {
    const graphView = RightsListView({
      state: {
        kind: 'ready',
        result: {
          indexUnavailable: false,
          rows: [
            memberRow({ graph: right(RIGHT, null), preview: { decision: 'REJECT', reason: 'REVOKED' } }),
          ],
        },
      },
    })
    const memoryView = RightsListView({
      state: {
        kind: 'ready',
        result: {
          indexUnavailable: false,
          rows: [
            memberRow({ memory: { addedAt: 1, holder: HOLDER_A, uid: UID_C }, preview: null, uid: UID_C }),
          ],
        },
      },
    })

    expect(viewText(graphView)).toContain('REVOKED')
    expect(viewText(graphView)).not.toContain('ACTIVE')
    expect(viewText(memoryView)).toContain('Saved on this device')
  })
})
