import * as v from 'valibot'

import type { Hex } from './constants.ts'

const PAGE_SIZE = 1000
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/u
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u

const HexSchema = v.pipe(
  v.string(),
  v.regex(HEX),
  v.transform((input): Hex => `0x${input.slice(2)}`),
)

const AddressSchema = v.pipe(
  v.string(),
  v.regex(ADDRESS),
  v.transform((input): Hex => `0x${input.slice(2).toLowerCase()}`),
)

const AnnouncementSchema = v.object({
  blockNumber: v.pipe(v.string(), v.regex(DECIMAL)),
  caller: HexSchema,
  ephemeralPubKey: HexSchema,
  id: v.string(),
  logIndex: v.pipe(v.string(), v.regex(DECIMAL)),
  metadata: HexSchema,
  schemeId: v.pipe(v.string(), v.regex(DECIMAL)),
  stealthAddress: HexSchema,
  timestamp: v.pipe(v.string(), v.regex(DECIMAL)),
  transactionHash: HexSchema,
})

const ResponseSchema = v.union([
  v.object({ data: v.object({ announcements: v.array(AnnouncementSchema) }) }),
  v.object({ errors: v.array(v.object({ message: v.string() })) }),
])

const ErrorsSchema = v.object({ errors: v.array(v.object({ message: v.string() })) })

const DelegationSchema = v.object({
  active: v.boolean(),
  id: HexSchema,
  issuer: AddressSchema,
  name: v.string(),
  revokedAt: v.nullable(v.pipe(v.string(), v.regex(DECIMAL))),
})

const RightSchema = v.object({
  delegation: DelegationSchema,
  holder: AddressSchema,
  id: HexSchema,
  issuer: AddressSchema,
  level: v.pipe(v.number(), v.integer()),
  metaURI: v.string(),
  revokedAt: v.nullable(v.pipe(v.string(), v.regex(DECIMAL))),
  schemaVersion: v.pipe(v.number(), v.integer()),
  serial: HexSchema,
  tier: v.pipe(v.number(), v.integer()),
  usageModel: v.pipe(v.number(), v.integer()),
  validFrom: v.pipe(v.string(), v.regex(DECIMAL)),
  validUntil: v.pipe(v.string(), v.regex(DECIMAL)),
})

const AttendanceSchema = v.object({
  enteredAt: v.pipe(v.string(), v.regex(DECIMAL)),
  holder: AddressSchema,
  id: HexSchema,
  rightUID: HexSchema,
  slotId: HexSchema,
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
  delegation: GraphDelegation
  holder: Hex
  id: Hex
  issuer: Hex
  level: number
  metaURI: string
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
  variables: Readonly<Record<string, string>>,
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

const nullableBigInt = (value: string | null): bigint | null => (value === null ? null : BigInt(value))

const toDelegation = (row: v.InferOutput<typeof DelegationSchema>): GraphDelegation => ({
  ...row,
  revokedAt: nullableBigInt(row.revokedAt),
})

const toRight = (row: v.InferOutput<typeof RightSchema>): GraphRight => ({
  ...row,
  delegation: toDelegation(row.delegation),
  revokedAt: nullableBigInt(row.revokedAt),
  validFrom: BigInt(row.validFrom),
  validUntil: BigInt(row.validUntil),
})

const toAttendance = (row: v.InferOutput<typeof AttendanceSchema>): GraphAttendance => ({
  ...row,
  enteredAt: BigInt(row.enteredAt),
  timestamp: BigInt(row.timestamp),
})

const RIGHTS_QUERY = `query RightsByHolder($holder: Bytes!) {
  rights(where: { holder: $holder }, orderBy: timestamp, orderDirection: desc) {
    id holder issuer usageModel tier level serial validFrom validUntil metaURI schemaVersion revokedAt
    delegation { id issuer active name revokedAt }
  }
}`

const ATTENDANCES_QUERY = `query AttendancesByRight($right: Bytes!) {
  attendances(where: { right: $right }, orderBy: timestamp, orderDirection: desc) {
    id rightUID holder enteredAt slotId timestamp
  }
}`

const DELEGATIONS_QUERY = `query DelegationsByIssuer($issuer: Bytes!) {
  delegations(where: { issuer: $issuer }, orderBy: timestamp, orderDirection: desc) {
    id issuer active name revokedAt
  }
}`

export const fetchRightsByHolder = async (
  endpoint: string,
  holder: string,
  signal?: AbortSignal,
): Promise<GraphRight[]> => {
  const body = await postGraph(
    RightsResponseSchema,
    endpoint,
    RIGHTS_QUERY,
    { holder: normalizedAddress(holder) },
    signal,
  )
  if ('errors' in body) {
    throw graphErrors(body.errors)
  }
  return body.data.rights.map(toRight)
}

export const fetchAttendancesByRight = async (
  endpoint: string,
  right: Hex,
  signal?: AbortSignal,
): Promise<GraphAttendance[]> => {
  const body = await postGraph(AttendancesResponseSchema, endpoint, ATTENDANCES_QUERY, { right }, signal)
  if ('errors' in body) {
    throw graphErrors(body.errors)
  }
  return body.data.attendances.map(toAttendance)
}

export const fetchDelegationsByIssuer = async (
  endpoint: string,
  issuer: string,
  signal?: AbortSignal,
): Promise<GraphDelegation[]> => {
  const body = await postGraph(
    DelegationsResponseSchema,
    endpoint,
    DELEGATIONS_QUERY,
    { issuer: normalizedAddress(issuer) },
    signal,
  )
  if ('errors' in body) {
    throw graphErrors(body.errors)
  }
  return body.data.delegations.map(toDelegation)
}

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
      throw new Error(
        body.output.errors.length === 0
          ? 'GraphQL request failed'
          : body.output.errors.map(({ message }) => message).join('; '),
      )
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
