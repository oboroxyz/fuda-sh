import * as v from 'valibot'

import type { Hex } from './constants.ts'

const PAGE_SIZE = 1000
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/u
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u

const HexSchema = v.pipe(
  v.string(),
  v.regex(HEX),
  v.transform((input): Hex => `0x${input.slice(2)}`),
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
