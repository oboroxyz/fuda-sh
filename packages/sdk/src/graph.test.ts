import { describe, expect, it, vi } from 'vitest'

import { fetchAnnouncements } from './graph.ts'

const TX_A = `0x${'aa'.repeat(32)}`
const TX_B = `0x${'bb'.repeat(32)}`

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
