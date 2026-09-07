import { passUrls } from '@fuda/sdk'
import type { GraphRight, Hex, PassUrls, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'
import type { PassMemoryEntry } from './pass-memory.ts'

export interface MemberPassRow {
  uid: Hex
  graph: GraphRight | null
  memory: PassMemoryEntry | null
  preview: VerifyResponse | null
  passes: PassUrls
  googleHref: string | null
  appleHref: string | null
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
  const withRemembered = [...addresses, ...memory.map(({ holder }) => holder)]
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

const isPublicLevel = (level: number | undefined): boolean => level === 0 || level === 1

const isPublicPreview = (preview: VerifyResponse | null): boolean =>
  isPublicLevel(preview?.entitlement?.level)

const isNonPublicPreview = (preview: VerifyResponse | null): boolean =>
  preview?.entitlement !== undefined && !isPublicPreview(preview)

export class PrivatePassRecoveryError extends Error {
  constructor() {
    super('This is a +Private pass. Open Private rights to recover it.')
    this.name = 'PrivatePassRecoveryError'
  }
}

export const rememberQueryPass = async (
  uid: Hex,
  verify: MemberPassListIo['verify'],
  remember: (pass: Pick<PassMemoryEntry, 'holder' | 'uid'>) => void,
): Promise<PassMemoryEntry | null> => {
  const preview = await verify(uid)
  if (!preview.ok) {
    throw new Error(preview.error)
  }
  if (!isPublicPreview(preview.body)) {
    throw new PrivatePassRecoveryError()
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
  const passes = passUrls(API_BASE_URL, uid)
  const [googleHref, appleAvailable] = await Promise.all([
    settledValue(io.googleHref(passes.google)),
    settledValue(io.appleAvailable(passes.apple)),
  ])
  return { appleHref: appleAvailable === true ? passes.apple : null, googleHref, passes }
}

const unlinkedPassesOf = (uid: Hex): Pick<MemberPassRow, 'appleHref' | 'googleHref' | 'passes'> => ({
  appleHref: null,
  googleHref: null,
  passes: passUrls(API_BASE_URL, uid),
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
  const nonPublicUids = new Set(
    memoryPreviews.filter(({ preview }) => isNonPublicPreview(preview)).map(({ entry }) => keyOf(entry.uid)),
  )
  const publicMemory = memoryPreviews
    .filter(({ preview }) => isPublicPreview(preview))
    .map(({ entry }) => entry)
  let rights: GraphRight[] = []
  let indexUnavailable = !input.graphConfigured
  if (input.graphConfigured) {
    const fetched = await Promise.allSettled(
      uniqueAddresses(input.addresses, publicMemory).map(async (holder) => await io.fetchRights(holder)),
    )
    rights = fetched.flatMap((result) => {
      if (result.status === 'rejected') {
        indexUnavailable = true
        return []
      }
      return result.value
    })
  }

  for (const right of rights) {
    if (!isPublicLevel(right.level)) {
      nonPublicUids.add(keyOf(right.id))
    }
  }
  const publicRights = rights.filter((right) => isPublicLevel(right.level))
  const eligibleMemory = memoryPreviews
    .filter(
      ({ entry, preview }) =>
        !nonPublicUids.has(keyOf(entry.uid)) && (preview === null || isPublicPreview(preview)),
    )
    .map(({ entry }) => entry)
  const seeds = rowsFrom(eligibleMemory, publicRights).filter((seed) => !nonPublicUids.has(keyOf(seed.uid)))
  const rowsWithPrivateFiltered = await Promise.all(
    seeds.map(async (seed) => {
      const uidKey = keyOf(seed.uid)
      const preview = previewByUid.has(uidKey)
        ? (previewByUid.get(uidKey) ?? null)
        : await previewOf(seed.uid, io.verify)
      if (isNonPublicPreview(preview)) {
        return null
      }
      const links =
        isPublicLevel(seed.graph?.level) || isPublicPreview(preview)
          ? await linksOf(seed.uid, io)
          : unlinkedPassesOf(seed.uid)
      return { ...seed, ...links, preview }
    }),
  )
  const rows = rowsWithPrivateFiltered.filter((row): row is MemberPassRow => row !== null)
  return { indexUnavailable, rows }
}

export const refreshPassStatuses = async (
  rows: readonly MemberPassRow[],
  verify: MemberPassListIo['verify'],
): Promise<MemberPassRow[]> => {
  const refreshed = await Promise.all(
    rows.map(async (row) => {
      const preview = await previewOf(row.uid, verify)
      return isNonPublicPreview(preview) ? null : { ...row, preview }
    }),
  )
  return refreshed.filter((row): row is MemberPassRow => row !== null)
}

interface RefreshTicket {
  listGeneration: number
  refreshGeneration: number
}

export interface PassListRefreshGate {
  beginListLoad: () => number
  isListCurrent: (generation: number) => boolean
  beginRefresh: (listGeneration: number) => RefreshTicket
  isRefreshCurrent: (ticket: RefreshTicket) => boolean
}

export const createPassListRefreshGate = (): PassListRefreshGate => {
  let listGeneration = 0
  let refreshGeneration = 0
  return {
    beginListLoad: () => {
      listGeneration += 1
      refreshGeneration += 1
      return listGeneration
    },
    beginRefresh: (ticketListGeneration) => {
      refreshGeneration += 1
      return { listGeneration: ticketListGeneration, refreshGeneration }
    },
    isListCurrent: (generation) => generation === listGeneration,
    isRefreshCurrent: (ticket) =>
      ticket.listGeneration === listGeneration && ticket.refreshGeneration === refreshGeneration,
  }
}

export const refreshCurrentPassStatuses = async (
  gate: PassListRefreshGate,
  listGeneration: number,
  rows: readonly MemberPassRow[],
  verify: MemberPassListIo['verify'],
): Promise<MemberPassRow[] | null> => {
  const ticket = gate.beginRefresh(listGeneration)
  const refreshed = await refreshPassStatuses(rows, verify)
  return gate.isRefreshCurrent(ticket) ? refreshed : null
}

export interface VisibleRefreshIo<TInterval> {
  setInterval: (callback: () => void, milliseconds: number) => TInterval
  clearInterval: (interval: TInterval) => void
  visibilityState: () => DocumentVisibilityState
}

export interface VisibleRefreshHost<TInterval> {
  setInterval: (callback: () => void, milliseconds: number) => TInterval
  clearInterval: (interval: TInterval) => void
  document: Pick<Document, 'visibilityState'>
}

export const visibleRefreshIoFrom = <TInterval>(
  host: VisibleRefreshHost<TInterval>,
): VisibleRefreshIo<TInterval> => ({
  clearInterval: (interval) => {
    host.clearInterval(interval)
  },
  setInterval: (callback, milliseconds) => host.setInterval(callback, milliseconds),
  visibilityState: () => host.document.visibilityState,
})

export const scheduleVisibleRefresh = <TInterval>(
  refresh: () => void,
  io: VisibleRefreshIo<TInterval>,
): (() => void) => {
  const interval = io.setInterval(() => {
    if (io.visibilityState() === 'visible') {
      refresh()
    }
  }, 30_000)
  return () => {
    io.clearInterval(interval)
  }
}
