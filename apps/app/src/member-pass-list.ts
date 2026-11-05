import { hasNoHolder, isPasskeyPass } from '@fuda/sdk'
import type { GraphRight, Hex, PassCardView, PassUrls, StampSummary, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'

import { memberPassUrls } from './pass-links.ts'
import type { PassMemoryEntry } from './pass-memory.ts'

export interface MemberPassRow {
  uid: Hex
  graph: GraphRight | null
  memory: PassMemoryEntry | null
  preview: VerifyResponse | null
  passes: PassUrls
  googleHref: string | null
  appleHref: string | null
  stamps: StampSummary | null
  // the venue card the pass was issued under; null keeps the plain fuda look
  card: PassCardView | null
}

export interface MemberPassListInput {
  addresses: readonly Hex[]
  memory: readonly PassMemoryEntry[]
  graphConfigured: boolean
}

export interface MemberPassListIo {
  fetchRights: (holder: Hex) => Promise<GraphRight[]>
  verify: (uid: Hex) => Promise<Result<VerifyResponse>>
  googleHref: (url: string) => Promise<string | null>
  appleAvailable: (url: string) => Promise<boolean>
  stampSummary: (uid: Hex) => Promise<StampSummary | null>
  card: (uid: Hex) => Promise<PassCardView | null>
}

export interface MemberPassListResult {
  rows: MemberPassRow[]
  indexUnavailable: boolean
}

interface RowSeed {
  uid: Hex
  graph: GraphRight | null
  memory: PassMemoryEntry | null
}

const keyOf = (value: Hex): string => value.toLowerCase()

export const withConnectedAddress = (addresses: readonly Hex[], address: Hex): Hex[] => {
  const target = keyOf(address)
  return addresses.some((stored) => keyOf(stored) === target) ? [...addresses] : [...addresses, address]
}

export const connectMemberRail = async <T>(
  open: () => Promise<T>,
  request: (provider: T) => Promise<Hex>,
): Promise<Hex> => await request(await open())

const uniqueAddresses = (addresses: readonly Hex[], memory: readonly PassMemoryEntry[]): Hex[] => {
  // An offchain pass has no holder to look up; the zero address would only return
  // whatever others happen to have attested to it.
  const withRemembered = [...addresses, ...memory.map(({ holder }) => holder)].filter(
    (address) => !hasNoHolder(address),
  )
  const seen = new Set<string>()
  return withRemembered.filter((address) => {
    const key = keyOf(address)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const uniqueMemory = (memory: readonly PassMemoryEntry[]): PassMemoryEntry[] => {
  const sorted = [...memory].toSorted((left, right) => right.addedAt - left.addedAt)
  const seen = new Set<string>()
  return sorted.filter((entry) => {
    const key = keyOf(entry.uid)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const settledValue = async <T>(promise: Promise<T>): Promise<T | null> => {
  try {
    return await promise
  } catch {
    return null
  }
}

const previewOf = async (uid: Hex, verify: MemberPassListIo['verify']): Promise<VerifyResponse | null> => {
  const result = await settledValue(verify(uid))
  return result?.ok === true ? result.body : null
}

const isSupportedLevel = (level: number | undefined): boolean => level === 0 || level === 1

const isSupportedPreview = (preview: VerifyResponse | null): boolean =>
  isSupportedLevel(preview?.entitlement?.level)

const isUnsupportedPreview = (preview: VerifyResponse | null): boolean =>
  preview?.entitlement !== undefined && !isSupportedPreview(preview)

export const rememberQueryPass = async (
  uid: Hex,
  verify: MemberPassListIo['verify'],
  remember: (pass: Pick<PassMemoryEntry, 'holder' | 'uid'>) => void,
): Promise<PassMemoryEntry | null> => {
  const preview = await verify(uid)
  if (!preview.ok) {
    throw new Error(preview.error)
  }
  if (!isSupportedPreview(preview.body)) {
    throw new Error('this pass is of a kind that is no longer issued')
  }
  const holder = preview.body.entitlement?.holder
  if (holder === undefined) {
    return null
  }
  const pass = { holder, uid }
  remember(pass)
  return { ...pass, addedAt: Date.now() }
}

type PassRequest = (url: string, init?: RequestInit) => Promise<Response>

// The Google API's JSON is an untrusted network boundary: only an explicitly
// successful response with the documented saveUrl becomes a link in the UI.
export const googlePassHref = async (
  url: string,
  request: PassRequest = globalThis.fetch,
): Promise<string | null> => {
  try {
    const response = await request(url)
    if (!response.ok) {
      return null
    }
    const body: unknown = await response.json()
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- this is the narrow JSON boundary for the external Google response
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !('saveUrl' in body)) {
      return null
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the parsed record is trusted only when saveUrl is a string
    return typeof body.saveUrl === 'string' ? body.saveUrl : null
  } catch {
    return null
  }
}

export const applePassAvailable = async (
  url: string,
  request: PassRequest = globalThis.fetch,
): Promise<boolean> => {
  try {
    const response = await request(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

const linksOf = async (
  uid: Hex,
  io: Pick<MemberPassListIo, 'appleAvailable' | 'googleHref'>,
): Promise<Pick<MemberPassRow, 'appleHref' | 'googleHref' | 'passes'>> => {
  const passes = memberPassUrls(uid)
  const [googleHref, appleAvailable] = await Promise.all([
    settledValue(io.googleHref(passes.google)),
    settledValue(io.appleAvailable(passes.apple)),
  ])
  return { appleHref: appleAvailable === true ? passes.apple : null, googleHref, passes }
}

const unlinkedPassesOf = (uid: Hex): Pick<MemberPassRow, 'appleHref' | 'googleHref' | 'passes'> => ({
  appleHref: null,
  googleHref: null,
  passes: memberPassUrls(uid),
})

const rowsFrom = (memory: readonly PassMemoryEntry[], graph: readonly GraphRight[]): RowSeed[] => {
  const memoryRows: RowSeed[] = uniqueMemory(memory).map((entry) => ({
    graph: null,
    memory: entry,
    uid: entry.uid,
  }))
  const byUid = new Map(memoryRows.map((row) => [keyOf(row.uid), row]))
  const graphOnly: RowSeed[] = []

  for (const right of graph) {
    const existing = byUid.get(keyOf(right.id))
    if (existing !== undefined) {
      existing.graph = right
      continue
    }
    const row = { graph: right, memory: null, uid: right.id }
    byUid.set(keyOf(right.id), row)
    graphOnly.push(row)
  }
  return [...memoryRows, ...graphOnly]
}

export const loadMemberPassList = async (
  input: MemberPassListInput,
  io: MemberPassListIo,
): Promise<MemberPassListResult> => {
  const remembered = uniqueMemory(input.memory)
  const memoryPreviews = await Promise.all(
    remembered.map(async (entry) => ({ entry, preview: await previewOf(entry.uid, io.verify) })),
  )
  const previewByUid = new Map(memoryPreviews.map(({ entry, preview }) => [keyOf(entry.uid), preview]))
  const unsupportedUids = new Set(
    memoryPreviews
      .filter(({ preview }) => isUnsupportedPreview(preview))
      .map(({ entry }) => keyOf(entry.uid)),
  )
  const publicMemory = memoryPreviews
    .filter(({ preview }) => isSupportedPreview(preview))
    .map(({ entry }) => entry)
  let rights: GraphRight[] = []
  const holders = uniqueAddresses(input.addresses, publicMemory)
  // With no holder to look up, as for a member with only offchain passes, there is
  // nothing the index could have added, so its absence is not worth a warning.
  let indexUnavailable = !input.graphConfigured && holders.length > 0
  if (input.graphConfigured) {
    const fetched = await Promise.allSettled(holders.map(async (holder) => await io.fetchRights(holder)))
    rights = fetched.flatMap((result) => {
      if (result.status === 'rejected') {
        indexUnavailable = true
        return []
      }
      return result.value
    })
  }

  for (const right of rights) {
    if (!isSupportedLevel(right.level)) {
      unsupportedUids.add(keyOf(right.id))
    }
  }
  const supportedRights = rights.filter((right) => isSupportedLevel(right.level))
  const eligibleMemory = memoryPreviews
    .filter(({ entry }) => !unsupportedUids.has(keyOf(entry.uid)))
    .map(({ entry }) => entry)
  const seeds = rowsFrom(eligibleMemory, supportedRights).filter(
    (seed) => !unsupportedUids.has(keyOf(seed.uid)),
  )
  const listedRows = await Promise.all(
    seeds.map(async (seed) => {
      const uidKey = keyOf(seed.uid)
      const preview = previewByUid.has(uidKey)
        ? (previewByUid.get(uidKey) ?? null)
        : await previewOf(seed.uid, io.verify)
      if (isUnsupportedPreview(preview)) {
        return null
      }
      const supportedRow = isSupportedLevel(seed.graph?.level) || isSupportedPreview(preview)
      const keyBound = preview?.entitlement !== undefined && isPasskeyPass(preview.entitlement)
      const links = supportedRow && !keyBound ? await linksOf(seed.uid, io) : unlinkedPassesOf(seed.uid)
      const [stamps, card] = supportedRow
        ? await Promise.all([settledValue(io.stampSummary(seed.uid)), settledValue(io.card(seed.uid))])
        : [null, null]
      return { ...seed, ...links, card, preview, stamps }
    }),
  )
  const rows = listedRows.filter((row): row is MemberPassRow => row !== null)
  return { indexUnavailable, rows }
}
