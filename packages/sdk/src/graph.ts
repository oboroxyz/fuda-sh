import * as v from 'valibot'

import type { Hex } from './constants.ts'

const PAGE_SIZE = 1000
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/u
const BYTES_20 = /^0x[0-9a-fA-F]{40}$/u
const BYTES_32 = /^0x[0-9a-fA-F]{64}$/u
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u

const HexSchema = v.pipe(
  v.string(),
  v.regex(HEX),
  v.transform((input): Hex => `0x${input.slice(2)}`),
)

const Bytes20Schema = v.pipe(
  v.string(),
  v.regex(BYTES_20),
  v.transform((input): Hex => `0x${input.slice(2)}`),
)

const Bytes32Schema = v.pipe(
  v.string(),
  v.regex(BYTES_32),
  v.transform((input): Hex => `0x${input.slice(2)}`),
)

const AddressSchema = v.pipe(
  v.string(),
  v.regex(BYTES_20),
  v.transform((input): Hex => `0x${input.slice(2).toLowerCase()}`),
)

const AnnouncementSchema = v.object({
  blockNumber: v.pipe(v.string(), v.regex(DECIMAL)),
  caller: Bytes20Schema,
  ephemeralPubKey: HexSchema,
  id: v.string(),
  logIndex: v.pipe(v.string(), v.regex(DECIMAL)),
  metadata: HexSchema,
  schemeId: v.pipe(v.string(), v.regex(DECIMAL)),
  stealthAddress: Bytes20Schema,
  timestamp: v.pipe(v.string(), v.regex(DECIMAL)),
  transactionHash: Bytes32Schema,
})

const ErrorsSchema = v.object({ errors: v.array(v.object({ message: v.string() })) })

const ResponseSchema = v.union([
  ErrorsSchema,
  v.object({ data: v.object({ announcements: v.array(AnnouncementSchema) }) }),
])

const DelegationSchema = v.object({
  active: v.boolean(),
  id: Bytes32Schema,
  issuer: AddressSchema,
  name: v.string(),
  revokedAt: v.nullable(v.pipe(v.string(), v.regex(DECIMAL))),
})

const RightSchema = v.object({
  delegation: v.nullable(DelegationSchema),
  holder: AddressSchema,
  id: Bytes32Schema,
  issuer: AddressSchema,
  level: v.pipe(v.number(), v.integer()),
  metaURI: v.string(),
  refUID: Bytes32Schema,
  revokedAt: v.nullable(v.pipe(v.string(), v.regex(DECIMAL))),
  schemaVersion: v.pipe(v.number(), v.integer()),
  serial: Bytes32Schema,
  tier: v.pipe(v.number(), v.integer()),
  usageModel: v.pipe(v.number(), v.integer()),
  validFrom: v.pipe(v.string(), v.regex(DECIMAL)),
  validUntil: v.pipe(v.string(), v.regex(DECIMAL)),
})

const AttendanceSchema = v.object({
  enteredAt: v.pipe(v.string(), v.regex(DECIMAL)),
  holder: AddressSchema,
  id: Bytes32Schema,
  rightUID: Bytes32Schema,
  slotId: Bytes32Schema,
  timestamp: v.pipe(v.string(), v.regex(DECIMAL)),
})

const RightsResponseSchema = v.union([
  ErrorsSchema,
  v.object({ data: v.object({ rights: v.array(RightSchema) }) }),
])
const AttendancesResponseSchema = v.union([
  ErrorsSchema,
  v.object({ data: v.object({ attendances: v.array(AttendanceSchema) }) }),
])
const DelegationsResponseSchema = v.union([
  ErrorsSchema,
  v.object({ data: v.object({ delegations: v.array(DelegationSchema) }) }),
])

export interface GraphAnnouncement {
  blockNumber: bigint
  caller: Hex
  ephemeralPubKey: Hex
  id: string
  logIndex: bigint
  metadata: Hex
  schemeId: bigint
  stealthAddress: Hex
  timestamp: bigint
  transactionHash: Hex
}

export interface GraphDelegation {
  active: boolean
  id: Hex
  issuer: Hex
  name: string
  revokedAt: bigint | null
}

export interface GraphRight {
  delegation: GraphDelegation | null
  holder: Hex
  id: Hex
  issuer: Hex
  level: number
  metaURI: string
  refUID: Hex
  revokedAt: bigint | null
  schemaVersion: number
  serial: Hex
  tier: number
  usageModel: number
  validFrom: bigint
  validUntil: bigint
}

export interface GraphAttendance {
  enteredAt: bigint
  holder: Hex
  id: Hex
  rightUID: Hex
  slotId: Hex
  timestamp: bigint
}

const ANNOUNCEMENTS_QUERY = `query Announcements($first: Int!, $afterBlock: BigInt!, $afterId: Bytes!) {
  announcements(
    first: $first
    orderBy: blockNumber
    orderDirection: asc
    where: { or: [{ blockNumber_gt: $afterBlock }, { blockNumber: $afterBlock, id_gt: $afterId }] }
  ) {
    id
    schemeId
    stealthAddress
    caller
    ephemeralPubKey
    metadata
    transactionHash
    logIndex
    blockNumber
    timestamp
  }
}`

const toAnnouncement = (row: v.InferOutput<typeof AnnouncementSchema>): GraphAnnouncement => ({
  blockNumber: BigInt(row.blockNumber),
  caller: row.caller,
  ephemeralPubKey: row.ephemeralPubKey,
  id: row.id,
  logIndex: BigInt(row.logIndex),
  metadata: row.metadata,
  schemeId: BigInt(row.schemeId),
  stealthAddress: row.stealthAddress,
  timestamp: BigInt(row.timestamp),
  transactionHash: row.transactionHash,
})

const graphErrors = (errors: v.InferOutput<typeof ErrorsSchema>['errors']): Error =>
  new Error(errors.length === 0 ? 'GraphQL request failed' : errors.map(({ message }) => message).join('; '))

const postGraph = async <TOutput>(
  schema: v.GenericSchema<unknown, TOutput>,
  endpoint: string,
  query: string,
  variables: Readonly<Record<string, number | string>>,
  signal?: AbortSignal,
): Promise<TOutput> => {
  const response = await fetch(endpoint, {
    body: JSON.stringify({ query, variables }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Graph endpoint returned ${response.status}`)
  }
  const body = v.safeParse(schema, await response.json())
  if (!body.success) {
    throw new Error('invalid Graph response')
  }
  return body.output
}

const normalizedAddress = (address: string): Hex => {
  const parsed = v.safeParse(AddressSchema, address)
  if (!parsed.success) {
    throw new Error('invalid address')
  }
  return parsed.output
}

const bytes32 = (value: string): Hex => {
  const parsed = v.safeParse(Bytes32Schema, value)
  if (!parsed.success) {
    throw new Error('invalid bytes32')
  }
  return parsed.output
}

const nullableBigInt = (value: string | null): bigint | null => (value === null ? null : BigInt(value))

const toDelegation = (row: v.InferOutput<typeof DelegationSchema>): GraphDelegation => ({
  ...row,
  revokedAt: nullableBigInt(row.revokedAt),
})

const toRight = (row: v.InferOutput<typeof RightSchema>): GraphRight => ({
  ...row,
  delegation: row.delegation === null ? null : toDelegation(row.delegation),
  revokedAt: nullableBigInt(row.revokedAt),
  validFrom: BigInt(row.validFrom),
  validUntil: BigInt(row.validUntil),
})

const toAttendance = (row: v.InferOutput<typeof AttendanceSchema>): GraphAttendance => ({
  ...row,
  enteredAt: BigInt(row.enteredAt),
  timestamp: BigInt(row.timestamp),
})

const RIGHTS_QUERY = `query RightsByHolder($holder: Bytes!, $first: Int!, $afterId: Bytes!) {
  rights(first: $first, where: { holder: $holder, id_gt: $afterId }, orderBy: id, orderDirection: asc) {
    id holder issuer usageModel tier level serial validFrom validUntil metaURI schemaVersion refUID revokedAt
    delegation { id issuer active name revokedAt }
  }
}`

const ATTENDANCES_QUERY = `query AttendancesByRight($right: Bytes!, $first: Int!, $afterId: Bytes!) {
  attendances(first: $first, where: { right: $right, id_gt: $afterId }, orderBy: id, orderDirection: asc) {
    id rightUID holder enteredAt slotId timestamp
  }
}`

const DELEGATIONS_QUERY = `query DelegationsByIssuer($issuer: Bytes!, $first: Int!, $afterId: Bytes!) {
  delegations(first: $first, where: { issuer: $issuer, id_gt: $afterId }, orderBy: id, orderDirection: asc) {
    id issuer active name revokedAt
  }
}`

const fetchGraphPages = async <TBody, TRow, TResult>(
  schema: v.GenericSchema<unknown, TBody>,
  endpoint: string,
  query: string,
  variables: Readonly<Record<string, string>>,
  pageOf: (body: TBody) => TRow[],
  idOf: (row: TRow) => string,
  convert: (row: TRow) => TResult,
  signal?: AbortSignal,
): Promise<TResult[]> => {
  const rows: TResult[] = []
  let afterId = '0x'
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- each Graph page starts at the previous page's stable id cursor
    const body = await postGraph(schema, endpoint, query, { ...variables, afterId, first: PAGE_SIZE }, signal)
    const page = pageOf(body)
    rows.push(...page.map(convert))
    const last = page.at(-1)
    if (page.length < PAGE_SIZE || last === undefined) {
      break
    }
    afterId = idOf(last)
  }
  return rows
}

export const fetchRightsByHolder = async (
  endpoint: string,
  holder: string,
  signal?: AbortSignal,
): Promise<GraphRight[]> =>
  await fetchGraphPages(
    RightsResponseSchema,
    endpoint,
    RIGHTS_QUERY,
    { holder: normalizedAddress(holder) },
    (body) => {
      if ('errors' in body) {
        throw graphErrors(body.errors)
      }
      return body.data.rights
    },
    ({ id }) => id,
    toRight,
    signal,
  )

export const fetchAttendancesByRight = async (
  endpoint: string,
  right: Hex,
  signal?: AbortSignal,
): Promise<GraphAttendance[]> =>
  await fetchGraphPages(
    AttendancesResponseSchema,
    endpoint,
    ATTENDANCES_QUERY,
    { right: bytes32(right) },
    (body) => {
      if ('errors' in body) {
        throw graphErrors(body.errors)
      }
      return body.data.attendances
    },
    ({ id }) => id,
    toAttendance,
    signal,
  )

export const fetchDelegationsByIssuer = async (
  endpoint: string,
  issuer: string,
  signal?: AbortSignal,
): Promise<GraphDelegation[]> =>
  await fetchGraphPages(
    DelegationsResponseSchema,
    endpoint,
    DELEGATIONS_QUERY,
    { issuer: normalizedAddress(issuer) },
    (body) => {
      if ('errors' in body) {
        throw graphErrors(body.errors)
      }
      return body.data.delegations
    },
    ({ id }) => id,
    toDelegation,
    signal,
  )

export const fetchAnnouncements = async (
  endpoint: string,
  fromBlock: bigint,
  signal?: AbortSignal,
): Promise<GraphAnnouncement[]> => {
  if (fromBlock < 0n) {
    throw new Error('fromBlock must be non-negative')
  }
  const rows: GraphAnnouncement[] = []
  let afterBlock = fromBlock - 1n
  let afterId = '0x'

  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- each Graph page starts at the cursor returned by the previous page
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        query: ANNOUNCEMENTS_QUERY,
        variables: { afterBlock: afterBlock.toString(), afterId, first: PAGE_SIZE },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal,
    })
    if (!response.ok) {
      throw new Error(`Graph endpoint returned ${response.status}`)
    }
    // oxlint-disable-next-line no-await-in-loop -- response parsing belongs to the same sequential cursor request
    const body = v.safeParse(ResponseSchema, await response.json())
    if (!body.success) {
      throw new Error('invalid Graph response')
    }
    if ('errors' in body.output) {
      throw graphErrors(body.output.errors)
    }
    const page = body.output.data.announcements
    rows.push(...page.map(toAnnouncement))
    const last = page.at(-1)
    if (page.length < PAGE_SIZE || last === undefined) {
      break
    }
    afterBlock = BigInt(last.blockNumber)
    afterId = last.id
  }

  return rows.toSorted((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber < right.blockNumber ? -1 : 1
    }
    return left.id.localeCompare(right.id)
  })
}
