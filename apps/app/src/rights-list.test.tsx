// @vitest-environment happy-dom
import type { GraphRight, Hex, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { mount as mountView } from '@fuda/ui-preact/test'
import type { JSX } from 'preact'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import {
  applePassAvailable,
  connectMemberRail,
  googlePassHref,
  loadMemberPassList,
  rememberQueryPass,
  withConnectedAddress,
} from './member-pass-list.ts'
import type { MemberPassListIo, MemberPassRow } from './member-pass-list.ts'
import { RightsList, RightsListView } from './member/RightsList.tsx'
import { requestAccount } from './wallet.ts'

const RIGHT = `0x${'aa'.repeat(32)}` as const
const DELEGATION = `0x${'bb'.repeat(32)}` as const

type RightsListViewProps = Parameters<typeof RightsListView>[0]

const mount = (View: () => JSX.Element): HTMLElement => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = mountView(<View />, host)
  onTestFinished(() => {
    dispose.dispose()
    host.remove()
  })
  return host
}
const showView = (props: RightsListViewProps): HTMLElement =>
  mount(() => <RightsListView locale="en" {...props} />)
const viewText = (host: HTMLElement): string => host.textContent ?? ''
const hrefsOf = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('[href]')].map((node) => node.getAttribute('href') ?? '')

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

const admittedAtLevel = (holder: Hex, level: number): Result<VerifyResponse> => ({
  body: {
    decision: 'ADMIT',
    entitlement: {
      holder,
      issuer: `0x${'22'.repeat(20)}`,
      level,
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

const retiredLevelAdmitted = (holder: Hex): Result<VerifyResponse> => admittedAtLevel(holder, 2)

const memberIo = (fetchRights: MemberPassListIo['fetchRights']): MemberPassListIo => ({
  appleAvailable: async () => await Promise.resolve(false),
  card: async () => await Promise.resolve(null),
  fetchRights,
  googleHref: async () => await Promise.resolve(null),
  stampSummary: async () => await Promise.resolve(null),
  verify: async (uid) => await Promise.resolve(admitted(uid === UID_C ? HOLDER_B : HOLDER_A)),
})

const memberRow = (overrides: Partial<MemberPassRow>): MemberPassRow => ({
  appleHref: null,
  card: null,
  googleHref: null,
  graph: null,
  memory: null,
  passes: {
    apple: `/api/pass/${RIGHT}/apple.pkpass`,
    google: `/api/pass/${RIGHT}/google`,
    web: `/api/pass/${RIGHT}`,
  },
  preview: { decision: 'ADMIT', reason: 'OK' },
  stamps: null,
  uid: RIGHT,
  ...overrides,
})

describe(loadMemberPassList, () => {
  it('does not warn about a missing index when there is no holder to look up', async () => {
    const io = memberIo(async () => await Promise.resolve([]))
    const result = await loadMemberPassList(
      {
        addresses: [],
        graphConfigured: false,
        memory: [{ addedAt: 1, holder: `0x${'00'.repeat(20)}`, uid: RIGHT }],
      },
      io,
    )
    expect(result.indexUnavailable).toBe(false)
  })

  it('never asks the index about a remembered pass with no holder', async () => {
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(async () => await Promise.resolve([]))
    const result = await loadMemberPassList(
      {
        addresses: [],
        graphConfigured: true,
        memory: [{ addedAt: 1, holder: `0x${'00'.repeat(20)}`, uid: RIGHT }],
      },
      memberIo(fetchRights),
    )
    expect(fetchRights).not.toHaveBeenCalled()
    expect(result.rows.map((row) => row.uid)).toStrictEqual([RIGHT])
  })

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

  it('carries the venue card of a public pass into its row', async () => {
    const card = {
      brandColor: '#112233',
      cardTitle: 'Members',
      category: 'membership' as const,
      issuerName: 'Wassie Coffee',
      logoUrl: null,
      memberNumber: 'QJ2Y-XPHE-PDRKA',
    }
    const io = memberIo(async () => await Promise.resolve([]))

    const result = await loadMemberPassList(
      { addresses: [], graphConfigured: true, memory: [{ addedAt: 20, holder: HOLDER_A, uid: RIGHT }] },
      { ...io, card: async () => await Promise.resolve(card) },
    )

    expect(result.rows.map((row) => row.card)).toStrictEqual([card])
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

  it('excludes a Graph row of a level no longer issued before it verifies status or probes pass links', async () => {
    const verify = vi.fn<MemberPassListIo['verify']>(
      async () => await Promise.resolve(retiredLevelAdmitted(HOLDER_A)),
    )
    const googleHref = vi.fn<MemberPassListIo['googleHref']>(async () => await Promise.resolve(null))
    const appleAvailable = vi.fn<MemberPassListIo['appleAvailable']>(async () => await Promise.resolve(false))

    const result = await loadMemberPassList(
      { addresses: [HOLDER_A], graphConfigured: true, memory: [] },
      {
        appleAvailable,
        card: async () => await Promise.resolve(null),
        fetchRights: async () => await Promise.resolve([{ ...right(RIGHT, null), level: 2 }]),
        googleHref,
        stampSummary: async () => await Promise.resolve(null),
        verify,
      },
    )

    expect(result.rows).toStrictEqual([])
    expect(verify).not.toHaveBeenCalled()
    expect(googleHref).not.toHaveBeenCalled()
    expect(appleAvailable).not.toHaveBeenCalled()
  })

  it('does not query Graph discovery for a remembered pass of a level no longer issued', async () => {
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(async () => await Promise.resolve([]))

    const result = await loadMemberPassList(
      { addresses: [], graphConfigured: true, memory: [{ addedAt: 1, holder: HOLDER_A, uid: RIGHT }] },
      {
        appleAvailable: async () => await Promise.resolve(false),
        card: async () => await Promise.resolve(null),
        fetchRights,
        googleHref: async () => await Promise.resolve(null),
        stampSummary: async () => await Promise.resolve(null),
        verify: async () => await Promise.resolve(retiredLevelAdmitted(HOLDER_A)),
      },
    )

    expect(result.rows).toStrictEqual([])
    expect(fetchRights).not.toHaveBeenCalled()
  })

  it('keeps a failed remembered preview device-only without pass links or Graph discovery', async () => {
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(async () => await Promise.resolve([]))
    const googleHref = vi.fn<MemberPassListIo['googleHref']>(async () => await Promise.resolve(null))
    const appleAvailable = vi.fn<MemberPassListIo['appleAvailable']>(async () => await Promise.resolve(false))

    const result = await loadMemberPassList(
      { addresses: [], graphConfigured: true, memory: [{ addedAt: 1, holder: HOLDER_A, uid: RIGHT }] },
      {
        appleAvailable,
        card: async () => await Promise.resolve(null),
        fetchRights,
        googleHref,
        stampSummary: async () => await Promise.resolve(null),
        verify: async () =>
          await Promise.resolve({ error: 'offline', network: true, ok: false, status: 503 }),
      },
    )

    expect(result.rows).toMatchObject([{ appleHref: null, googleHref: null, preview: null, uid: RIGHT }])
    expect(fetchRights).not.toHaveBeenCalled()
    expect(googleHref).not.toHaveBeenCalled()
    expect(appleAvailable).not.toHaveBeenCalled()
  })

  it('never probes Wallet endpoints for an Identified pass', async () => {
    const googleHref = vi.fn<MemberPassListIo['googleHref']>()
    const appleAvailable = vi.fn<MemberPassListIo['appleAvailable']>()
    const zero: Hex = `0x${'00'.repeat(20)}`
    const result = await loadMemberPassList(
      { addresses: [], graphConfigured: false, memory: [{ addedAt: 1, holder: zero, uid: RIGHT }] },
      {
        ...memberIo(async () => await Promise.resolve([])),
        appleAvailable,
        googleHref,
        verify: async () => await Promise.resolve(admitted(zero)),
      },
    )
    expect(result.rows).toMatchObject([{ appleHref: null, googleHref: null, uid: RIGHT }])
    expect(googleHref).not.toHaveBeenCalled()
    expect(appleAvailable).not.toHaveBeenCalled()
  })

  it('keeps a rejected remembered public pass device-only without querying its unverified holder', async () => {
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(async () => await Promise.resolve([]))
    const googleHref = vi.fn<MemberPassListIo['googleHref']>(async () => await Promise.resolve(null))
    const appleAvailable = vi.fn<MemberPassListIo['appleAvailable']>(async () => await Promise.resolve(false))

    const result = await loadMemberPassList(
      { addresses: [], graphConfigured: true, memory: [{ addedAt: 1, holder: HOLDER_A, uid: RIGHT }] },
      {
        appleAvailable,
        card: async () => await Promise.resolve(null),
        fetchRights,
        googleHref,
        stampSummary: async () => await Promise.resolve(null),
        verify: async () =>
          await Promise.resolve({ body: { decision: 'REJECT', reason: 'REVOKED' }, ok: true }),
      },
    )

    expect(result.rows).toMatchObject([
      {
        appleHref: null,
        googleHref: null,
        preview: { decision: 'REJECT', reason: 'REVOKED' },
        uid: RIGHT,
      },
    ])
    expect(fetchRights).not.toHaveBeenCalled()
    expect(googleHref).not.toHaveBeenCalled()
    expect(appleAvailable).not.toHaveBeenCalled()
  })

  it('keeps a known non-public Graph UID out of a same-UID memory fallback after its preview fails', async () => {
    const googleHref = vi.fn<MemberPassListIo['googleHref']>(async () => await Promise.resolve(null))
    const appleAvailable = vi.fn<MemberPassListIo['appleAvailable']>(async () => await Promise.resolve(false))

    const result = await loadMemberPassList(
      {
        addresses: [HOLDER_A],
        graphConfigured: true,
        memory: [{ addedAt: 1, holder: HOLDER_A, uid: RIGHT }],
      },
      {
        appleAvailable,
        card: async () => await Promise.resolve(null),
        fetchRights: async () => await Promise.resolve([{ ...right(RIGHT, null), level: 2 }]),
        googleHref,
        stampSummary: async () => await Promise.resolve(null),
        verify: async () =>
          await Promise.resolve({ error: 'offline', network: true, ok: false, status: 503 }),
      },
    )

    expect(result.rows).toStrictEqual([])
    expect(googleHref).not.toHaveBeenCalled()
    expect(appleAvailable).not.toHaveBeenCalled()
  })
})

describe('pass link availability', () => {
  it('keeps the web pass URL and shows platform links only when their probes succeed', async () => {
    const google = 'https://wallet.google.test/save'
    const result = await loadMemberPassList(
      { addresses: [], graphConfigured: false, memory: [{ addedAt: 1, holder: HOLDER_A, uid: RIGHT }] },
      {
        appleAvailable: async () => await Promise.resolve(true),
        card: async () => await Promise.resolve(null),
        fetchRights: async () => await Promise.resolve([]),
        googleHref: async () => await Promise.resolve(google),
        stampSummary: async () => await Promise.resolve(null),
        verify: async () => await Promise.resolve(admitted(HOLDER_A)),
      },
    )

    expect(result.rows[0]).toMatchObject({
      appleHref: `/api/pass/${RIGHT}/apple.pkpass`,
      googleHref: google,
    })
    expect(result.rows[0]?.passes.web).toBe(`/api/pass/${RIGHT}`)
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

describe('member pass screen', () => {
  it('keeps public-address tools out of the main pass list', () => {
    const view = mount(() => (
      <RightsList locale="en" injected={{ request: async () => await Promise.resolve([HOLDER_A]) }} />
    ))
    const text = viewText(view)

    expect(text).toContain('Your passes')
    expect(text).not.toContain('activation')
    expect(text).not.toContain('Connect passkey')
    expect(text).not.toContain('Look up another public address')
  })
})

describe('member rails and query memory', () => {
  it('adds an injected or passkey account to the next address union without a signature', async () => {
    const requested: string[] = []
    const passkey = {
      request: async ({ method }: { method: string }) => {
        requested.push(method)
        return await Promise.resolve([HOLDER_A])
      },
    }
    const wallet = {
      request: async ({ method }: { method: string }) => {
        requested.push(method)
        return await Promise.resolve([HOLDER_B])
      },
    }
    const passkeyAddress = await connectMemberRail(async () => await Promise.resolve(passkey), requestAccount)
    const walletAddress = await connectMemberRail(async () => await Promise.resolve(wallet), requestAccount)
    const connected = withConnectedAddress(withConnectedAddress([], passkeyAddress), walletAddress)
    const fetchRights = vi.fn<MemberPassListIo['fetchRights']>(async () => await Promise.resolve([]))

    await loadMemberPassList(
      { addresses: connected, graphConfigured: true, memory: [] },
      memberIo(fetchRights),
    )

    expect(fetchRights).toHaveBeenCalledWith(HOLDER_A)
    expect(fetchRights).toHaveBeenCalledWith(HOLDER_B)
    expect(requested).toStrictEqual(['eth_requestAccounts', 'eth_requestAccounts'])
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

  it('does not remember a level-2 pass recovered from a /rights uid query', async () => {
    const remembered: { holder: Hex; uid: Hex }[] = []

    await expect(
      rememberQueryPass(
        RIGHT,
        async () => await Promise.resolve(retiredLevelAdmitted(HOLDER_A)),
        (pass) => {
          remembered.push(pass)
        },
      ),
    ).rejects.toThrow('no longer issued')

    expect(remembered).toStrictEqual([])
  })

  it('does not remember a level-3 pass recovered from a /rights uid query', async () => {
    const remembered: { holder: Hex; uid: Hex }[] = []

    await expect(
      rememberQueryPass(
        RIGHT,
        async () => await Promise.resolve(admittedAtLevel(HOLDER_A, 3)),
        (pass) => {
          remembered.push(pass)
        },
      ),
    ).rejects.toThrow('no longer issued')

    expect(remembered).toStrictEqual([])
  })

  it('reports an unsuccessful query preview instead of forgetting it', async () => {
    await expect(
      rememberQueryPass(
        RIGHT,
        async () => await Promise.resolve({ error: 'api 503', network: true, ok: false, status: 503 }),
        () => {},
      ),
    ).rejects.toThrow('api 503')
  })

  it('reports a transport query preview failure instead of forgetting it', async () => {
    await expect(
      rememberQueryPass(
        RIGHT,
        async () => await Promise.reject(new Error('offline')),
        () => {},
      ),
    ).rejects.toThrow('offline')
  })
})

describe(RightsListView, () => {
  it('renders separate active and revoked right cards', () => {
    const view = showView({
      state: { kind: 'ready', rights: [right(RIGHT, null), right(`0x${'cc'.repeat(32)}`, 88n)] },
    })
    const text = viewText(view)
    expect(view.querySelectorAll('li')).toHaveLength(2)
    expect(text).toContain('ACTIVE')
    expect(text).toContain('REVOKED')
    expect(text).toContain(RIGHT)
    expect(text).toContain('ipfs://right')
  })

  it('renders explicit loading, empty, and error states', () => {
    expect(viewText(showView({ state: { kind: 'loading' } }))).toContain('Loading rights')
    expect(viewText(showView({ state: { kind: 'ready', rights: [] } }))).toContain('No rights found')
    expect(viewText(showView({ state: { kind: 'error', message: 'Graph unavailable' } }))).toContain(
      'Graph unavailable',
    )
  })

  it('displays an unsafe metadata URI without making it a link', () => {
    const unsafe = { ...right(RIGHT, null), metaURI: ['javascript', 'alert(1)'].join(':') }
    const view = showView({ state: { kind: 'ready', rights: [unsafe] } })

    expect(viewText(view)).toContain(unsafe.metaURI)
    expect(hrefsOf(view)).not.toContain(unsafe.metaURI)
  })

  it('uses a live REVOKED preview over an active Graph row and tags memory-only rows', () => {
    const graphView = showView({
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
    const memoryView = showView({
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
    expect(viewText(memoryView)).toContain('Pass')
    expect(viewText(memoryView)).toContain('UID')
  })

  it('opens the individual pass without offering device wallet saves in the list', () => {
    const row = memberRow({
      appleHref: 'https://api.test/apple',
      googleHref: 'https://api.test/google',
      graph: right(RIGHT, null),
    })
    const view = showView({
      state: { kind: 'ready', result: { indexUnavailable: false, rows: [row] } },
    })
    const hrefs = hrefsOf(view)
    expect(hrefs).toContain(row.passes.web)
    expect(hrefs).not.toContain(row.appleHref)
    expect(hrefs).not.toContain(row.googleHref)
  })

  it('offers entry for a pass bound to a passkey, and says why there is no pass to show', () => {
    const row = memberRow({
      memory: { addedAt: 1, holder: `0x${'00'.repeat(20)}`, uid: RIGHT },
      preview: {
        decision: 'ADMIT',
        entitlement: {
          holder: `0x${'00'.repeat(20)}`,
          issuer: `0x${'22'.repeat(20)}`,
          level: 1,
          schemaVersion: 1,
          tier: 0,
          usageModel: 1,
          validFrom: 0,
          validUntil: 0,
        },
        reason: 'OK',
      },
    })
    const host = mount(() => (
      <RightsListView
        locale="en"
        state={{ kind: 'ready', result: { indexUnavailable: false, rows: [row] } }}
      />
    ))
    expect(host.querySelector(`a[href="/signed?uid=${RIGHT}"]`)).not.toBeNull()
    expect(host.textContent).not.toContain('View pass')
    expect(host.textContent).toContain('opens only with your passkey')
  })

  it('does not render pass links for an unclassified memory-only row', () => {
    const row = memberRow({ memory: { addedAt: 1, holder: HOLDER_A, uid: RIGHT }, preview: null })
    const view = showView({
      state: { kind: 'ready', result: { indexUnavailable: true, rows: [row] } },
    })

    expect(hrefsOf(view)).not.toContain(row.passes.web)
  })

  it('renders the exact saved-pass banner when the public index is unavailable', () => {
    const view = showView({
      state: { kind: 'ready', result: { indexUnavailable: true, rows: [memberRow({})] } },
    })

    expect(viewText(view)).toContain('index unavailable; showing passes saved on this device')
  })

  it('shows live enabled stamp progress on a public Pass', () => {
    const view = showView({
      state: {
        kind: 'ready',
        result: {
          indexUnavailable: false,
          rows: [memberRow({ stamps: { dailyLimit: 2, enabled: true, goal: 10, today: 1, total: 4 } })],
        },
      },
    })
    expect(viewText(view)).toContain('4 / 10 stamps')
    expect(viewText(view)).toContain('1 / 2 today')
  })

  it('draws a venue card in its own colour, mark, title and member number', () => {
    const view = showView({
      state: {
        kind: 'ready',
        result: {
          indexUnavailable: false,
          rows: [
            memberRow({
              card: {
                brandColor: '#112233',
                cardTitle: 'Members',
                category: 'membership',
                issuerName: 'Wassie Coffee',
                logoUrl: 'https://api.example.test/assets/coffee/logo/master?v=1',
                memberNumber: 'QJ2Y-XPHE-PDRKA',
              },
            }),
          ],
        },
      },
    })
    const text = viewText(view)
    const shown = ['Wassie Coffee', 'Members', 'MEMBER', 'QJ2Y-XPHE-PDRKA', 'UID'].map((part) =>
      text.includes(part),
    )
    expect(shown).toStrictEqual([true, true, true, true, false])
    const face = view.querySelector<HTMLElement>('.member-pass-preview')
    expect({ backgroundColor: face?.style.backgroundColor, color: face?.style.color }).toStrictEqual({
      backgroundColor: '#112233',
      color: '#FFFFFF',
    })
    expect(view.querySelector('img')?.getAttribute('src')).toBe(
      'https://api.example.test/assets/coffee/logo/master?v=1',
    )
  })
})
