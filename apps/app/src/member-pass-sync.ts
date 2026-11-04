import { MAX_LINKED_UIDS_PER_REQUEST } from '@fuda/sdk'
import type { Hex, MemberPassesResponse, MemberPassView } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'
import type { PassMemoryEntry } from './pass-memory.ts'

export interface PassSyncIo {
  link: (uids: readonly Hex[]) => Promise<Result<{ linked: number }>>
  list: () => Promise<Result<MemberPassesResponse>>
}

const defaultPassSyncIo: PassSyncIo = {
  link: async (uids) =>
    await apiFetch(API_BASE_URL, '/member/passes', { body: JSON.stringify({ uids }), method: 'POST' }),
  list: async () => await apiFetch(API_BASE_URL, '/member/passes'),
}

const chunksOf = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

// docs/specs/pass-types-and-flows.md#member-sign-in: what this device remembers joins the
// account, and what the account keeps comes back to this device. Answers the passes this
// device did not know, or an empty list if the service could not be reached: the device's
// own list still works without it, so nothing here is worth interrupting the member for.
export const syncMemberPasses = async (
  remembered: readonly PassMemoryEntry[],
  io: PassSyncIo = defaultPassSyncIo,
): Promise<MemberPassView[]> => {
  for (const part of chunksOf(
    remembered.map(({ uid }) => uid),
    MAX_LINKED_UIDS_PER_REQUEST,
  )) {
    // oxlint-disable-next-line no-await-in-loop -- a member holds few passes; order does not matter, and sequential keeps this gentle on the rate limit
    await io.link(part)
  }
  const listed = await io.list()
  if (!listed.ok) {
    return []
  }
  const known = new Set(remembered.map(({ uid }) => uid.toLowerCase()))
  return listed.body.passes.filter(({ uid }) => !known.has(uid.toLowerCase()))
}
