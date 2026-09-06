import { describe, expect, it, vi } from 'vitest'

import {
  fetchAnnouncements,
  fetchAttendancesByRight,
  fetchDelegationsByIssuer,
  fetchRightsByHolder,
} from './graph.ts'

const TX_A = `0x${'aa'.repeat(32)}` as const
const TX_B = `0x${'bb'.repeat(32)}` as const

const graphRow = (blockNumber: bigint, id = `${TX_A}00000000`) => ({
  blockNumber: blockNumber.toString(),
  caller: `0x${'22'.repeat(20)}`,
  ephemeralPubKey: '0x020304',
  id,
  logIndex: '7',
  metadata: '0xdeadbeef',
  schemeId: '340282366920938463463374607431768211457',
  stealthAddress: `0x${'11'.repeat(20)}`,
  timestamp: '456',
  transactionHash: TX_A,
})

const bytes32 = (value: number): `0x${string}` => `0x${value.toString(16).padStart(64, '0')}`

const delegationRow = (id: `0x${string}` = TX_B) => ({
  active: true,
  id,
  issuer: `0x${'22'.repeat(20)}`,
  name: 'root',
  revokedAt: null,
})

const rightRow = (id: `0x${string}` = TX_A) => ({
  delegation: delegationRow(),
  holder: `0x${'11'.repeat(20)}`,
  id,
  issuer: `0x${'22'.repeat(20)}`,
  level: 1,
  metaURI: 'ipfs://one',
  refUID: TX_B,
  revokedAt: null,
  schemaVersion: 1,
  serial: `0x${'00'.repeat(32)}`,
  tier: 2,
  usageModel: 1,
  validFrom: '0',
  validUntil: '999',
})

const attendanceRow = (id: `0x${string}` = TX_A) => ({
  enteredAt: '55',
  holder: `0x${'11'.repeat(20)}`,
  id,
  rightUID: TX_B,
  slotId: `0x${'00'.repeat(32)}`,
  timestamp: '56',
})

describe(fetchAnnouncements, () => {
  it('parses Graph scalars without losing bigint precision and keeps stable order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await Promise.resolve(
            Response.json({
              data: {
                announcements: [
                  graphRow(9_007_199_254_740_993n),
                  graphRow(9_007_199_254_740_994n, `${TX_B}00000001`),
                ],
              },
            }),
          ),
      ),
    )

    const rows = await fetchAnnouncements('https://graph.example/subgraphs/id/rights', 123n)

    expect(rows.map(({ blockNumber, schemeId }) => ({ blockNumber, schemeId }))).toStrictEqual([
      {
        blockNumber: 9_007_199_254_740_993n,
        schemeId: 340_282_366_920_938_463_463_374_607_431_768_211_457n,
      },
      {
        blockNumber: 9_007_199_254_740_994n,
        schemeId: 340_282_366_920_938_463_463_374_607_431_768_211_457n,
      },
    ])
  })

  it('fetches pages of 1000 using the last block and id as the next cursor', async () => {
    const first = Array.from({ length: 1000 }, (_, index) =>
      graphRow(200n, `${TX_A}${index.toString(16).padStart(8, '0')}`),
    )
    const last = first.at(-1)
    let requestCount = 0
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      requestCount += 1
      return await Promise.resolve(
        Response.json({
          data: {
            announcements: requestCount === 1 ? first : [graphRow(201n, `${TX_B}00000000`)],
          },
        }),
      )
    })
    vi.stubGlobal('fetch', spy)

    const rows = await fetchAnnouncements('https://graph.example/query', 100n)

    expect(rows).toHaveLength(1001)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1]?.[1]?.body).toContain(`"afterBlock":"${last?.blockNumber}"`)
    expect(spy.mock.calls[1]?.[1]?.body).toContain(`"afterId":"${last?.id}"`)
    expect(spy.mock.calls[1]?.[1]?.body).toContain('"first":1000')
  })

  it('rejects GraphQL errors and malformed response rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => await Promise.resolve(Response.json({ errors: [{ message: 'indexing failed' }] }))),
    )
    await expect(fetchAnnouncements('https://graph.example/query', 0n)).rejects.toThrow('indexing failed')

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => await Promise.resolve(Response.json({ data: { announcements: [{ blockNumber: 1 }] } })),
      ),
    )
    await expect(fetchAnnouncements('https://graph.example/query', 0n)).rejects.toThrow(
      'invalid Graph response',
    )
  })

  it('rejects partial announcement data when GraphQL also returns errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await Promise.resolve(
            Response.json({
              data: { announcements: [graphRow(1n)] },
              errors: [{ message: 'indexing failed' }],
            }),
          ),
      ),
    )

    await expect(fetchAnnouncements('https://graph.example/query', 0n)).rejects.toThrow('indexing failed')
  })

  it.each(['caller', 'stealthAddress', 'transactionHash'] as const)(
    'rejects an announcement with a wrong-width %s',
    async (field) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            await Promise.resolve(
              Response.json({ data: { announcements: [{ ...graphRow(1n), [field]: '0x12' }] } }),
            ),
        ),
      )

      await expect(fetchAnnouncements('https://graph.example/query', 0n)).rejects.toThrow(
        'invalid Graph response',
      )
    },
  )

  it('reports HTTP/network failures and forwards cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => await Promise.resolve(new Response('gateway', { status: 502 }))),
    )
    await expect(fetchAnnouncements('https://graph.example/query', 0n)).rejects.toThrow(
      'Graph endpoint returned 502',
    )

    const controller = new AbortController()
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal)
      return await Promise.reject(new DOMException('This operation was aborted', 'AbortError'))
    })
    vi.stubGlobal('fetch', spy)
    controller.abort()
    await expect(
      fetchAnnouncements('https://graph.example/query', 0n, controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('on-chain-status Graph queries', () => {
  it.each([`0x${'00'.repeat(32)}`, TX_B])(
    'keeps rights with unresolved delegation references (%s) in nested query results',
    async (refUID) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            await Promise.resolve(
              Response.json({
                data: { rights: [{ ...rightRow(), delegation: null, refUID }, rightRow(TX_B)] },
              }),
            ),
        ),
      )

      const rows = await fetchRightsByHolder('https://graph.example/query', `0x${'11'.repeat(20)}`)

      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ delegation: null, id: TX_A, refUID })
      expect(rows[1]?.delegation?.id).toBe(TX_B)
    },
  )

  it('fetches every rights page using the last id as a stable cursor', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => rightRow(bytes32(index + 1)))
    const second = rightRow(bytes32(1001))
    let request = 0
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      request += 1
      return await Promise.resolve(Response.json({ data: { rights: request === 1 ? first : [second] } }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const rows = await fetchRightsByHolder('https://graph.example/query', `0x${'11'.repeat(20)}`)

    expect(rows).toHaveLength(1001)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain(`"afterId":"${bytes32(1000)}"`)
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain('"first":1000')
  })

  it('fetches every attendance page using the last id as a stable cursor', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => attendanceRow(bytes32(index + 1)))
    const second = attendanceRow(bytes32(1001))
    let request = 0
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      request += 1
      return await Promise.resolve(Response.json({ data: { attendances: request === 1 ? first : [second] } }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const rows = await fetchAttendancesByRight('https://graph.example/query', TX_B)

    expect(rows).toHaveLength(1001)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain(`"afterId":"${bytes32(1000)}"`)
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain('"first":1000')
  })

  it('fetches every delegation page using the last id as a stable cursor', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => delegationRow(bytes32(index + 1)))
    const second = delegationRow(bytes32(1001))
    let request = 0
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      request += 1
      return await Promise.resolve(Response.json({ data: { delegations: request === 1 ? first : [second] } }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const rows = await fetchDelegationsByIssuer('https://graph.example/query', `0x${'22'.repeat(20)}`)

    expect(rows).toHaveLength(1001)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain(`"afterId":"${bytes32(1000)}"`)
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain('"first":1000')
  })

  it('normalizes the holder and returns multiple rights including revoked state', async () => {
    const holder = `0x${'AB'.repeat(20)}`
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        await Promise.resolve(
          Response.json({
            data: {
              rights: [
                {
                  delegation: {
                    active: true,
                    id: TX_B,
                    issuer: `0x${'22'.repeat(20)}`,
                    name: 'root',
                    revokedAt: null,
                  },
                  holder: holder.toLowerCase(),
                  id: TX_A,
                  issuer: `0x${'22'.repeat(20)}`,
                  level: 1,
                  metaURI: 'ipfs://one',
                  refUID: TX_B,
                  revokedAt: null,
                  schemaVersion: 1,
                  serial: `0x${'00'.repeat(32)}`,
                  tier: 2,
                  usageModel: 1,
                  validFrom: '0',
                  validUntil: '999',
                },
                {
                  delegation: {
                    active: false,
                    id: TX_B,
                    issuer: `0x${'22'.repeat(20)}`,
                    name: 'root',
                    revokedAt: '77',
                  },
                  holder: holder.toLowerCase(),
                  id: `0x${'cc'.repeat(32)}`,
                  issuer: `0x${'22'.repeat(20)}`,
                  level: 2,
                  metaURI: '',
                  refUID: TX_B,
                  revokedAt: '88',
                  schemaVersion: 1,
                  serial: `0x${'11'.repeat(32)}`,
                  tier: 3,
                  usageModel: 2,
                  validFrom: '10',
                  validUntil: '0',
                },
              ],
            },
          }),
        ),
    )
    vi.stubGlobal('fetch', spy)

    const rights = await fetchRightsByHolder('https://graph.example/query', holder)

    expect(rights).toHaveLength(2)
    expect(rights[1]).toMatchObject({ revokedAt: 88n, validFrom: 10n })
    expect(spy.mock.calls[0]?.[1]?.body).toContain(`"holder":"${holder.toLowerCase()}"`)
  })

  it('returns attendance and delegation relations, including empty results', async () => {
    const responses = [
      Response.json({
        data: {
          attendances: [
            {
              enteredAt: '55',
              holder: `0x${'11'.repeat(20)}`,
              id: TX_A,
              rightUID: TX_B,
              slotId: `0x${'00'.repeat(32)}`,
              timestamp: '56',
            },
          ],
        },
      }),
      Response.json({ data: { delegations: [] } }),
    ]
    let request = 0
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      const response = responses[request]
      request += 1
      return await Promise.resolve(response ?? Response.json({ data: {} }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchAttendancesByRight('https://graph.example/query', TX_B)).resolves.toMatchObject([
      { enteredAt: 55n, rightUID: TX_B },
    ])
    await expect(
      fetchDelegationsByIssuer('https://graph.example/query', `0x${'AB'.repeat(20)}`),
    ).resolves.toStrictEqual([])
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain(`"issuer":"0x${'ab'.repeat(20)}"`)
  })

  it('rejects a non-bytes32 right query input before fetching', async () => {
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchAttendancesByRight('https://graph.example/query', '0x12')).rejects.toThrow(
      'invalid bytes32',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects malformed on-chain-status responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => await Promise.resolve(Response.json({ data: { rights: [{ id: 'bad' }] } }))),
    )
    await expect(fetchRightsByHolder('https://graph.example/query', `0x${'11'.repeat(20)}`)).rejects.toThrow(
      'invalid Graph response',
    )
  })

  it('rejects right rows with malformed address fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await Promise.resolve(
            Response.json({
              data: {
                rights: [
                  {
                    delegation: {
                      active: true,
                      id: TX_B,
                      issuer: `0x${'22'.repeat(20)}`,
                      name: 'root',
                      revokedAt: null,
                    },
                    holder: '0x11',
                    id: TX_A,
                    issuer: `0x${'22'.repeat(20)}`,
                    level: 1,
                    metaURI: '',
                    revokedAt: null,
                    schemaVersion: 1,
                    serial: `0x${'00'.repeat(32)}`,
                    tier: 2,
                    usageModel: 1,
                    validFrom: '0',
                    validUntil: '999',
                  },
                ],
              },
            }),
          ),
      ),
    )

    await expect(fetchRightsByHolder('https://graph.example/query', `0x${'11'.repeat(20)}`)).rejects.toThrow(
      'invalid Graph response',
    )
  })

  it.each(['id', 'serial'] as const)('rejects a right with a non-bytes32 %s', async (field) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await Promise.resolve(Response.json({ data: { rights: [{ ...rightRow(), [field]: '0x12' }] } })),
      ),
    )

    await expect(fetchRightsByHolder('https://graph.example/query', `0x${'11'.repeat(20)}`)).rejects.toThrow(
      'invalid Graph response',
    )
  })

  it('rejects a right with a non-bytes32 delegation id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await Promise.resolve(
            Response.json({
              data: { rights: [{ ...rightRow(), delegation: delegationRow('0x12') }] },
            }),
          ),
      ),
    )

    await expect(fetchRightsByHolder('https://graph.example/query', `0x${'11'.repeat(20)}`)).rejects.toThrow(
      'invalid Graph response',
    )
  })

  it.each(['id', 'rightUID', 'slotId'] as const)(
    'rejects an attendance with a non-bytes32 %s',
    async (field) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            await Promise.resolve(
              Response.json({
                data: { attendances: [{ ...attendanceRow(), [field]: '0x12' }] },
              }),
            ),
        ),
      )

      await expect(fetchAttendancesByRight('https://graph.example/query', TX_B)).rejects.toThrow(
        'invalid Graph response',
      )
    },
  )

  it('surfaces GraphQL errors even when the response includes partial data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await Promise.resolve(
            Response.json({ data: { rights: [] }, errors: [{ message: 'indexing is behind' }] }),
          ),
      ),
    )

    await expect(fetchRightsByHolder('https://graph.example/query', `0x${'11'.repeat(20)}`)).rejects.toThrow(
      'indexing is behind',
    )
  })
})
