import type { QueryOptions } from '@fuda/libs/query'
import type { Hex } from '@fuda/sdk'

import { loadMemberPassList, rememberQueryPass } from './member-pass-list.ts'
import type { MemberPassListIo, MemberPassListResult } from './member-pass-list.ts'
import type { PassMemoryEntry } from './pass-memory.ts'

interface MemberPassListQueryInput {
  addresses: readonly Hex[]
  apiEndpoint: string
  graphEndpoint: string
  memory: readonly PassMemoryEntry[]
}

const normalizedAddresses = (addresses: readonly Hex[]): string[] =>
  [...new Set(addresses.map((address) => address.toLowerCase()))].toSorted()

const normalizedMemory = (
  memory: readonly PassMemoryEntry[],
): { addedAt: number; holder: string; uid: string }[] =>
  memory.map(({ addedAt, holder, uid }) => ({
    addedAt,
    holder: holder.toLowerCase(),
    uid: uid.toLowerCase(),
  }))

export const memberPassListQueryOptions = (
  input: MemberPassListQueryInput,
  io: MemberPassListIo,
): QueryOptions<MemberPassListResult> => ({
  queryFn: async () =>
    await loadMemberPassList(
      {
        addresses: input.addresses,
        graphConfigured: input.graphEndpoint !== '',
        memory: input.memory,
      },
      io,
    ),
  queryKey: [
    'member-passes',
    input.apiEndpoint,
    input.graphEndpoint,
    normalizedAddresses(input.addresses),
    normalizedMemory(input.memory),
  ],
  refetchInterval: 30_000,
})

export const memberPassRecoveryQueryOptions = (
  uid: Hex | null,
  apiEndpoint: string,
  io: MemberPassListIo,
): QueryOptions<PassMemoryEntry | null> => ({
  enabled: uid !== null,
  queryFn: async ({ signal }) => {
    if (uid === null) {
      return null
    }
    const pass = await rememberQueryPass(uid, io.verify, () => {
      // Persist only after the mounted component observes the recovered pass.
    })
    return signal.aborted ? null : pass
  },
  queryKey: ['member-pass-recovery', apiEndpoint, uid?.toLowerCase() ?? null],
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: Infinity,
})
