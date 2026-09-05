import type { Hex } from '@fuda/sdk'
import type { Result } from '@fuda/web-kit'
import { describe, expect, it, vi } from 'vitest'

import { challenge, MAX_PAGES, PAGE_ROWS, pageAnnouncements, verifySigned } from './api.ts'
import type { AnnouncementsResponse } from './api.ts'
import type { AnnouncementDto } from './private-member.ts'

const UID: Hex = `0x${'ab'.repeat(32)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`
const SIGNATURE: Hex = `0x${'11'.repeat(65)}`

// `fetch` is the only thing stubbed: the client is exercised through its real
// request/response handling. A sync stub is fine — `apiFetch` awaits its result.
const stubFetch = (impl: (url: string, init: RequestInit) => Response) => {
  const spy = vi.fn<(url: string, init: RequestInit) => Response>(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

const json = (body: unknown, status: number): Response => Response.json(body, { status })

describe(challenge, () => {
  it('POSTs /challenge with the uid and returns the minted challenge', async () => {
    const body = { challenge: `fuda-gate:${UID}:${NONCE}`, nonce: NONCE }
    const spy = stubFetch(() => json(body, 200))
    const result = await challenge(UID)
    expect(result).toStrictEqual({ body, ok: true })
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/challenge', {
      body: JSON.stringify({ uid: UID }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('maps a 4xx error body to a non-network failure', async () => {
    stubFetch(() => json({ error: 'bad_uid' }, 400))
    const result = await challenge(UID)
    expect(result).toStrictEqual({ error: 'bad_uid', network: false, ok: false, status: 400 })
  })
})

describe(verifySigned, () => {
  const body = { nonce: NONCE, signature: SIGNATURE, uid: UID }

  it('POSTs /verify-signed with uid, nonce and signature', async () => {
    const verdict = { decision: 'ADMIT', path: 'signature', reason: 'OK' }
    const spy = stubFetch(() => json(verdict, 200))
    const result = await verifySigned(body)
    expect(result).toStrictEqual({ body: verdict, ok: true })
    expect(spy).toHaveBeenCalledWith('http://localhost:8787/verify-signed', {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('treats a 5xx as a network condition', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 502 }))
    const result = await verifySigned(body)
    expect(result).toStrictEqual({ error: 'api 502', network: true, ok: false, status: 502 })
  })

  it('treats a transport failure as a network condition', async () => {
    stubFetch(() => {
      throw new Error('fetch failed')
    })
    const result = await verifySigned(body)
    expect(result).toStrictEqual({ error: 'fetch failed', network: true, ok: false, status: 0 })
  })
})

// One row per (txHash, logIndex), block-numbered so a page's last row names the
// block the next page restarts at.
const row = (blockNumber: number, logIndex = 0): AnnouncementDto => ({
  blockNumber,
  caller: `0x${'33'.repeat(20)}`,
  ephemeralPubKey: `0x02${'11'.repeat(32)}`,
  logIndex,
  metadata: `0x1f${'ab'.repeat(32)}`,
  schemeId: 1,
  stealthAddress: `0x${'22'.repeat(20)}`,
  txHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
})

type Page = Result<AnnouncementsResponse>
type PageFetcher = (from: number) => Promise<Page>

const page = (rows: AnnouncementDto[]): Page => ({
  body: { announcements: rows, syncedTo: rows.at(-1)?.blockNumber ?? null },
  ok: true,
})

const fullPage = (start: number): AnnouncementDto[] =>
  Array.from({ length: PAGE_ROWS }, (_, i) => row(start + i))

describe(pageAnnouncements, () => {
  it('stops on a short page and asks for it from the given block', async () => {
    const fetchPage = vi.fn<PageFetcher>(async (from) => await Promise.resolve(page([row(from + 1)])))
    const result = await pageAnnouncements(fetchPage, 500)
    expect(result).toStrictEqual({ body: { complete: true, rows: [row(501)] }, ok: true })
    expect(fetchPage.mock.calls).toStrictEqual([[500]])
  })

  it('follows a full page from its last block and dedupes the repeated boundary row', async () => {
    const first = fullPage(1)
    const boundary = first.at(-1) ?? row(0)
    const fetchPage = vi.fn<PageFetcher>(
      async (from) =>
        await Promise.resolve(page(from === 0 ? first : [boundary, row(boundary.blockNumber + 1)])),
    )
    const result = await pageAnnouncements(fetchPage)
    expect(fetchPage.mock.calls).toStrictEqual([[0], [boundary.blockNumber]])
    expect(result.ok).toBe(true)
    expect(result.ok ? result.body.complete : null).toBe(true)
    expect(result.ok ? result.body.rows : []).toHaveLength(PAGE_ROWS + 1)
  })

  it('gives up after the page cap and reports the list as incomplete', async () => {
    // Every page is full and never advances past its own last block, the case
    // the cap exists for.
    const fetchPage = vi.fn<PageFetcher>(async (from) => await Promise.resolve(page(fullPage(from + 1))))
    const result = await pageAnnouncements(fetchPage)
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES)
    expect(result.ok ? result.body.complete : null).toBe(false)
  })

  it('hands back the first failing page as-is', async () => {
    const failure = { error: 'rate_limited', network: false, ok: false, status: 429 } as const
    const fetchPage = vi.fn<PageFetcher>(
      async (from) => await Promise.resolve(from === 0 ? page(fullPage(1)) : failure),
    )
    const result = await pageAnnouncements(fetchPage)
    expect(result).toStrictEqual(failure)
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
})
