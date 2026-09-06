import { passUrls } from '@fuda/sdk'
import type { GraphRight, Hex, PassUrls, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/ui'

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

const uniqueAddresses = (input: MemberPassListInput): Hex[] => {
  const addresses = [...input.addresses, ...input.memory.map(({ holder }) => holder)]
  const seen = new Set<string>()
  return addresses.filter((address) => {
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

export const rememberQueryPass = async (
  uid: Hex,
  verify: MemberPassListIo['verify'],
  remember: (pass: Pick<PassMemoryEntry, 'holder' | 'uid'>) => void,
): Promise<PassMemoryEntry | null> => {
  const preview = await verify(uid)
  if (!preview.ok) {
    throw new Error(preview.error)
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
  let rights: GraphRight[] = []
  let indexUnavailable = !input.graphConfigured
  if (input.graphConfigured) {
    const fetched = await Promise.allSettled(
      uniqueAddresses(input).map(async (holder) => await io.fetchRights(holder)),
    )
    rights = fetched.flatMap((result) => {
      if (result.status === 'rejected') {
        indexUnavailable = true
        return []
      }
      return result.value
    })
  }

  const seeds = rowsFrom(input.memory, rights)
  const rows = await Promise.all(
    seeds.map(async (seed) => {
      const [preview, links] = await Promise.all([previewOf(seed.uid, io.verify), linksOf(seed.uid, io)])
      return { ...seed, ...links, preview }
    }),
  )
  return { indexUnavailable, rows }
}

export const refreshPassStatuses = async (
  rows: readonly MemberPassRow[],
  verify: MemberPassListIo['verify'],
): Promise<MemberPassRow[]> =>
  await Promise.all(rows.map(async (row) => ({ ...row, preview: await previewOf(row.uid, verify) })))

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
