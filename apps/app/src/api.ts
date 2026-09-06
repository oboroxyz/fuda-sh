import type { ChallengeResponse, Hex, VerifySignedResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/ui'
import type { Result } from '@fuda/ui'

import { API_BASE_URL } from './config.ts'
import type { AnnouncementDto } from './private-member.ts'

export const challenge = async (uid: Hex): Promise<Result<ChallengeResponse>> =>
  await apiFetch<ChallengeResponse>(API_BASE_URL, '/challenge', {
    body: JSON.stringify({ uid }),
    method: 'POST',
  })

export const verifySigned = async (body: {
  uid: Hex
  nonce: Hex
  signature: Hex
}): Promise<Result<VerifySignedResponse>> =>
  await apiFetch<VerifySignedResponse>(API_BASE_URL, '/verify-signed', {
    body: JSON.stringify(body),
    method: 'POST',
  })

export interface AnnouncementsResponse {
  announcements: AnnouncementDto[]
  syncedTo: number | null
}

// The whole cached ERC-5564 log from the floor: matching is client-side, so the
// api never learns which rows are this member's (docs/specs/attestation-model.md#announcement-cache-get-announcements).
export const announcements = async (fromBlock = 0): Promise<Result<AnnouncementsResponse>> =>
  await apiFetch<AnnouncementsResponse>(API_BASE_URL, `/announcements?fromBlock=${fromBlock}`)

// GET /announcements answers at most this many rows per call (ANNOUNCEMENTS_LIMIT
// in the api). A full page therefore means "there may be more".
export const PAGE_ROWS = 1000
// A stop for the pathological case: a single block holding more than PAGE_ROWS
// announcements would make every page start at the same block and never end.
// 50 pages is ~50k announcements, far past anything the MVP can produce.
export const MAX_PAGES = 50

export interface PagedAnnouncements {
  rows: AnnouncementDto[]
  // false when the page cap was hit: the list on screen is a prefix, not the whole log.
  complete: boolean
}

const rowKey = (row: AnnouncementDto): string => `${row.txHash}:${row.logIndex}`

// Walks `/announcements` page by page. The api pages by block number, not by an
// opaque cursor, so the next page restarts at the last row's block: every row in
// that boundary block comes back a second time, and (tx_hash, log_index) — the
// api's own primary key — dedupes them. The fetcher is injected so the loop is
// testable without a network.
export const pageAnnouncements = async (
  fetchPage: (fromBlock: number) => Promise<Result<AnnouncementsResponse>>,
  fromBlock = 0,
): Promise<Result<PagedAnnouncements>> => {
  const rows: AnnouncementDto[] = []
  const seen = new Set<string>()
  let from = fromBlock
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- pages are sequential: each start block comes from the page before it
    const res = await fetchPage(from)
    if (!res.ok) {
      return res
    }
    const batch = res.body.announcements
    for (const row of batch) {
      if (!seen.has(rowKey(row))) {
        seen.add(rowKey(row))
        rows.push(row)
      }
    }
    const last = batch.at(-1)
    if (batch.length < PAGE_ROWS || last === undefined) {
      return { body: { complete: true, rows }, ok: true }
    }
    from = last.blockNumber
  }
  return { body: { complete: false, rows }, ok: true }
}
