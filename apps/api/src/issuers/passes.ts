import { CARD_CATEGORIES } from '@fuda/sdk'
import type { IssuerPassesResponse, IssuerPassStatus, IssuerPassView } from '@fuda/sdk'
import * as v from 'valibot'

const LAST_30_DAYS_SECONDS = 30 * 86_400

export interface IssuerPassFilters {
  cardId: string | null
  page: number
  pageSize: number
  q: string
  status: IssuerPassStatus | null
}

const ISSUER_PASS_STATUSES = [
  'active',
  'revoked',
  'expired',
  'not_yet_valid',
  'consumed',
  'unknown',
] as const satisfies readonly IssuerPassStatus[]

const PassResultRow = v.object({
  cardCategory: v.nullable(v.picklist(CARD_CATEGORIES)),
  cardId: v.nullable(v.string()),
  cardSlug: v.nullable(v.string()),
  cardTitle: v.nullable(v.string()),
  claimedAt: v.number(),
  holder: v.nullable(v.string()),
  memberNumber: v.string(),
  stamps: v.number(),
  status: v.picklist(ISSUER_PASS_STATUSES),
  uid: v.string(),
  validFrom: v.nullable(v.number()),
  validUntil: v.nullable(v.number()),
})

const CountResultRow = v.object({ total: v.number() })
const SummaryResultRow = v.object({
  active: v.number(),
  claimedLast30Days: v.number(),
  stamps: v.number(),
  total: v.number(),
  unknown: v.number(),
})
const CardStatsResultRow = v.object({
  active: v.number(),
  cardId: v.string(),
  issued: v.number(),
  unknown: v.number(),
})

// This precedence mirrors local gate behavior while staying explicit that old
// rows with no issuance snapshot have an unknown operational state.
const PASS_ROWS = `
  SELECT
    m.attestation_uid AS uid,
    m.member_id AS memberNumber,
    m.holder AS holder,
    m.created_at AS claimedAt,
    m.valid_from AS validFrom,
    m.valid_until AS validUntil,
    c.id AS cardId,
    c.slug AS cardSlug,
    c.title AS cardTitle,
    c.category AS cardCategory,
    CASE
      WHEN m.status = 'revoked' THEN 'revoked'
      WHEN m.valid_from IS NULL OR m.valid_until IS NULL OR m.usage_model IS NULL THEN 'unknown'
      WHEN m.valid_from != 0 AND ? < m.valid_from THEN 'not_yet_valid'
      WHEN m.valid_until != 0 AND ? > m.valid_until THEN 'expired'
      WHEN m.usage_model = 0 AND EXISTS (
        SELECT 1 FROM slots s WHERE s.uid = m.attestation_uid AND s.slot = 'default'
      ) THEN 'consumed'
      ELSE 'active'
    END AS status
  FROM members m
  LEFT JOIN cards c ON c.id = m.card_id AND c.issuer_id = m.issuer_id
  WHERE m.issuer_id = ? AND m.level != 'private'
`

const escapeLike = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')

interface FilteredWhere {
  params: (number | string)[]
  sql: string
}

const filteredWhere = (filters: IssuerPassFilters): FilteredWhere => {
  const clauses: string[] = []
  const params: (number | string)[] = []
  if (filters.q !== '') {
    const pattern = `%${escapeLike(filters.q)}%`
    clauses.push(`(
      pass_rows.memberNumber LIKE ? ESCAPE '\\'
      OR pass_rows.uid LIKE ? ESCAPE '\\'
      OR pass_rows.holder LIKE ? ESCAPE '\\'
      OR pass_rows.cardTitle LIKE ? ESCAPE '\\'
      OR pass_rows.cardSlug LIKE ? ESCAPE '\\'
    )`)
    params.push(pattern, pattern, pattern, pattern, pattern)
  }
  if (filters.cardId !== null) {
    clauses.push('pass_rows.cardId = ?')
    params.push(filters.cardId)
  }
  if (filters.status !== null) {
    clauses.push('pass_rows.status = ?')
    params.push(filters.status)
  }
  return { params, sql: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}` }
}

const asNumber = (value: number | null | undefined): number => value ?? 0

export const readIssuerPasses = async (
  database: D1Database,
  issuerId: string,
  now: number,
  filters: IssuerPassFilters,
): Promise<IssuerPassesResponse> => {
  const filtered = filteredWhere(filters)
  const baseParams = [now, now, issuerId] as const
  const stampTotals = `
    SELECT issuer_id, uid, COUNT(*) AS stamps
    FROM stamp_credits
    WHERE issuer_id = ?
    GROUP BY issuer_id, uid
  `
  const pageStatement = database
    .prepare(`
      WITH pass_rows AS (${PASS_ROWS}), stamp_totals AS (${stampTotals})
      SELECT pass_rows.*, COALESCE(stamp_totals.stamps, 0) AS stamps
      FROM pass_rows
      LEFT JOIN stamp_totals
        ON stamp_totals.issuer_id = ? AND stamp_totals.uid = pass_rows.uid
      ${filtered.sql}
      ORDER BY claimedAt DESC, uid ASC
      LIMIT ? OFFSET ?
    `)
    .bind(
      ...baseParams,
      issuerId,
      issuerId,
      ...filtered.params,
      filters.pageSize,
      (filters.page - 1) * filters.pageSize,
    )
  const countStatement = database
    .prepare(`WITH pass_rows AS (${PASS_ROWS}) SELECT COUNT(*) AS total FROM pass_rows ${filtered.sql}`)
    .bind(...baseParams, ...filtered.params)
  const summaryStatement = database
    .prepare(`
      WITH pass_rows AS (${PASS_ROWS}), stamp_totals AS (${stampTotals})
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN pass_rows.status = 'active' THEN 1 ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN pass_rows.status = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown,
        COALESCE(SUM(COALESCE(stamp_totals.stamps, 0)), 0) AS stamps,
        COALESCE(SUM(CASE WHEN pass_rows.claimedAt >= ? THEN 1 ELSE 0 END), 0) AS claimedLast30Days
      FROM pass_rows
      LEFT JOIN stamp_totals
        ON stamp_totals.issuer_id = ? AND stamp_totals.uid = pass_rows.uid
    `)
    .bind(...baseParams, issuerId, now - LAST_30_DAYS_SECONDS, issuerId)
  const cardStatsStatement = database
    .prepare(`
      WITH pass_rows AS (${PASS_ROWS})
      SELECT
        c.id AS cardId,
        COUNT(pass_rows.uid) AS issued,
        COALESCE(SUM(CASE WHEN pass_rows.status = 'active' THEN 1 ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN pass_rows.status = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown
      FROM cards c
      LEFT JOIN pass_rows ON pass_rows.cardId = c.id
      WHERE c.issuer_id = ?
      GROUP BY c.id
      ORDER BY c.created_at ASC, c.id ASC
    `)
    .bind(...baseParams, issuerId)

  const [pageResult, countResult, summaryResult, cardStatsResult] = await database.batch([
    pageStatement,
    countStatement,
    summaryStatement,
    cardStatsStatement,
  ])
  const passes: IssuerPassView[] = v.parse(v.array(PassResultRow), pageResult.results).map((row) => ({
    card:
      row.cardId === null || row.cardSlug === null || row.cardTitle === null || row.cardCategory === null
        ? null
        : { category: row.cardCategory, id: row.cardId, slug: row.cardSlug, title: row.cardTitle },
    claimedAt: row.claimedAt,
    holder: row.holder,
    memberNumber: row.memberNumber,
    stamps: asNumber(row.stamps),
    status: row.status,
    uid: row.uid,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  }))
  const [count] = v.parse(v.array(CountResultRow), countResult.results)
  const [summary] = v.parse(v.array(SummaryResultRow), summaryResult.results)
  const cardStats = v.parse(v.array(CardStatsResultRow), cardStatsResult.results)
  return {
    cardStats: cardStats.map((row) => ({
      active: asNumber(row.active),
      cardId: row.cardId,
      issued: asNumber(row.issued),
      unknown: asNumber(row.unknown),
    })),
    page: { number: filters.page, size: filters.pageSize, total: asNumber(count?.total) },
    passes,
    summary: {
      active: asNumber(summary?.active),
      claimedLast30Days: asNumber(summary?.claimedLast30Days),
      stamps: asNumber(summary?.stamps),
      total: asNumber(summary?.total),
      unknown: asNumber(summary?.unknown),
    },
  }
}
