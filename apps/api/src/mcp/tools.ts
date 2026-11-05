import {
  CARD_CAPACITY_MAX,
  CardBody,
  CARD_CATEGORIES,
  CARD_IDENTITIES,
  CARD_RECORDS,
  ClaimSource,
  isOrderedWindow,
  normalizeUid,
} from '@fuda/sdk'
import type { ConnectedAppScope, IssuerPassStatus } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import * as v from 'valibot'

import type { Db } from '../db/client.ts'
import { cards, issuers } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { issueForCard } from '../issue/issue-for-card.ts'
import { insertCard } from '../issuers/create.ts'
import { fieldErrorFor } from '../issuers/field-error.ts'
import { readIssuerPasses } from '../issuers/passes.ts'
import { cardView, publicUrlFor } from '../issuers/views.ts'
import { spendBudget } from '../middleware/rate-limit.ts'
import { revokePass } from '../passes/revoke-pass.ts'

// Per issuer, per hour. These bound what a looping agent can spend on the
// signer or undo; docs/specs/mcp.md#tools.
export const ISSUE_BUDGET = 100
export const REVOKE_BUDGET = 20

// docs/specs/mcp.md#tools — every tool acts for the token's one issuer.
export interface ToolContext {
  c: Context<AppEnv>
  issuer: typeof issuers.$inferSelect
}

// `subject` names what a write acted on, for the connected-app activity record.
export type ToolOutcome =
  | { ok: true; subject?: string; value: object }
  | { ok: false; error: string; subject?: string }

export interface McpTool {
  annotations: { destructiveHint?: boolean; readOnlyHint: boolean }
  description: string
  inputSchema: object
  name: string
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON-RPC arguments stay untyped until the tool's own schema parses them
  run: (context: ToolContext, args: unknown) => Promise<ToolOutcome>
  scope: ConnectedAppScope
  title: string
}

export const issuerOf = async (db: Db, issuerId: string): Promise<typeof issuers.$inferSelect | undefined> =>
  await db.select().from(issuers).where(eq(issuers.id, issuerId)).get()

const toolCard = ({ c, issuer }: ToolContext, row: typeof cards.$inferSelect) => ({
  ...cardView(row, c.get('now')()),
  attendance: row.attendance !== 0,
  capacity: row.capacity,
  claimUrl: `${publicUrlFor(c.env.PUBLIC_BASE_URL, issuer.handle)}/${row.slug}`,
  issued: row.reserved,
})

const unixOrNull = { minimum: 0, type: ['integer', 'null'] }

const PASS_STATUSES = [
  'active',
  'revoked',
  'expired',
  'not_yet_valid',
  'consumed',
  'unknown',
] as const satisfies readonly IssuerPassStatus[]

const ListPassesArgs = v.strictObject({
  cardId: v.optional(v.string()),
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 25),
  source: v.optional(ClaimSource),
  status: v.optional(v.picklist(PASS_STATUSES)),
})
const IssuePassArgs = v.strictObject({ cardId: v.string(), source: v.optional(ClaimSource) })
const CardLimitsArgs = v.strictObject({
  capacity: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(CARD_CAPACITY_MAX))),
  ),
  cardId: v.string(),
  claimFrom: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
  claimUntil: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
})

const capacitySchema = {
  description: 'The most passes this card may ever issue; null for no limit. A revoked pass still counts.',
  maximum: CARD_CAPACITY_MAX,
  minimum: 1,
  type: ['integer', 'null'],
}
const sourceSchema = {
  description: 'A label for where this pass came from: lowercase letters, digits, hyphens and underscores.',
  pattern: '^[a-z0-9_-]{1,40}$',
  type: 'string',
}
const RevokePassArgs = v.strictObject({ uid: v.string() })

/* oxlint-disable eslint/sort-keys -- tool definitions read in the order MCP documents them */
export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'list_cards',
    title: 'List cards',
    description:
      "List this profile's cards, oldest first, with passes issued and any capacity. Each card has a claimUrl: the public page where a person gets a pass. To see which link people came through, append ?source=<label> to it for each flyer or post, then filter list_passes by that source.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    scope: 'cards:read',
    run: async (context) => {
      const rows = await context.c
        .get('db')
        .select()
        .from(cards)
        .where(eq(cards.issuerId, context.issuer.id))
        .orderBy(cards.createdAt)
      return {
        ok: true,
        value: {
          issuer: { handle: context.issuer.handle, name: context.issuer.name },
          cards: rows.map((row) => toolCard(context, row)),
        },
      }
    },
  },
  {
    name: 'create_card',
    title: 'Create card',
    description:
      'Create and immediately publish a card for this profile. A card expires after validityDays or between validFrom and validUntil, not both. Times are unix seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        attendance: {
          type: 'boolean',
          description:
            "Whether each scan writes a public Attendance record on chain, which is permanent. Only for record 'onchain', where a ticket defaults to true and a membership to false; setting it on an off-chain card is refused.",
        },
        category: { type: 'string', enum: CARD_CATEGORIES },
        capacity: capacitySchema,
        title: { type: 'string', minLength: 1, maxLength: 60 },
        slug: {
          type: 'string',
          description: "The card's path in its public URL: lowercase ASCII, digits and single hyphens.",
        },
        description: { type: 'string' },
        lockScreen: { type: 'boolean' },
        record: {
          type: 'string',
          enum: CARD_RECORDS,
          description:
            "Where this card's passes are recorded, fixed once created. 'offchain' (the default) issues at once with no public record per pass; 'onchain' publishes each pass.",
        },
        identity: {
          type: 'string',
          enum: CARD_IDENTITIES,
          description:
            "Who can use this card's passes, fixed once created. 'none' (the default) means whoever shows one. 'passkey' binds each pass to the passkey of the person who claimed it, so a copied QR does not admit. 'sensitive' goes further for employee badges and privacy-sensitive memberships: each pass has its own key, so a person is not linkable across venues, with no Wallet pass, QR, backup file, Stamps or integrations, and it rejects while the chain cannot be read. Members need a passkey provider that supports PRF, such as iCloud Keychain or Google Password Manager. Both need record 'offchain', and issue_pass cannot issue either, because the holder must claim it themselves at the card's claimUrl.",
        },
        claimFrom: unixOrNull,
        claimUntil: unixOrNull,
        validFrom: unixOrNull,
        validUntil: unixOrNull,
        validityDays: { type: ['integer', 'null'], minimum: 1, maximum: 3650 },
      },
      required: ['category', 'title', 'slug'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    scope: 'cards:write',
    run: async (context, args) => {
      const parsed = v.safeParse(CardBody, args)
      if (!parsed.success) {
        return { ok: false, error: fieldErrorFor(parsed.issues, 'slug', 'bad_slug') }
      }
      const now = context.c.get('now')()
      const card = await insertCard(context.c.get('db'), context.issuer.id, parsed.output, now)
      return card === null
        ? { ok: false, error: 'slug_taken' }
        : { ok: true, subject: card.id, value: { card: toolCard(context, card) } }
    },
  },
  {
    name: 'update_card_limits',
    title: 'Update card limits',
    description:
      'Change how many passes a card may issue and when people can claim it. Only the fields you send change. Lowering capacity below the passes already issued stops new ones and leaves those passes alone. A closed claim window makes the card invite-only: issue_pass still works.',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string', description: 'The id of a card from list_cards.' },
        capacity: capacitySchema,
        claimFrom: unixOrNull,
        claimUntil: unixOrNull,
      },
      required: ['cardId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    scope: 'cards:write',
    run: async (context, args) => {
      const parsed = v.safeParse(CardLimitsArgs, args)
      if (!parsed.success) {
        return { ok: false, error: 'bad_input' }
      }
      const { cardId, ...limits } = parsed.output
      const db = context.c.get('db')
      const where = and(eq(cards.id, cardId), eq(cards.issuerId, context.issuer.id))
      const card = await db.select().from(cards).where(where).get()
      if (card === undefined) {
        return { ok: false, error: 'not_found' }
      }
      const next = { ...card, ...limits }
      if (!isOrderedWindow(next.claimFrom, next.claimUntil)) {
        return { ok: false, error: 'bad_input' }
      }
      const [updated] = await db
        .update(cards)
        .set({ capacity: next.capacity, claimFrom: next.claimFrom, claimUntil: next.claimUntil })
        .where(where)
        .returning()
      return updated === undefined
        ? { ok: false, error: 'not_found' }
        : { ok: true, subject: updated.id, value: { card: toolCard(context, updated) } }
    },
  },
  {
    name: 'list_passes',
    title: 'List passes',
    description:
      "List this profile's passes, newest first, with totals for the profile and for each card. Status comes from fuda's records, not a live chain read.",
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        source: sourceSchema,
        status: { type: 'string', enum: PASS_STATUSES },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    scope: 'passes:read',
    run: async ({ c, issuer }, args) => {
      const parsed = v.safeParse(ListPassesArgs, args)
      if (!parsed.success) {
        return { ok: false, error: 'bad_input' }
      }
      const { cardId, page, pageSize, source, status } = parsed.output
      return {
        ok: true,
        value: await readIssuerPasses(c.env.DB, issuer.id, c.get('now')(), {
          cardId: cardId ?? null,
          page,
          pageSize,
          q: '',
          source: source ?? null,
          status: status ?? null,
        }),
      }
    },
  },
  {
    name: 'issue_pass',
    title: 'Issue pass',
    description:
      "Issue one pass under a card, for a person you are arranging it for, and return a passUrl to give them. It works even while the card's claim window is closed. Each call issues a new pass and costs on-chain gas, so do not retry after an unclear failure without checking list_passes. For flyers or posts, share the card's claimUrl instead. A card with identity 'passkey' or 'sensitive' answers holder_must_claim: its holder has to claim the pass themselves at the claimUrl.",
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string', description: 'The id of a card from list_cards.' },
        source: sourceSchema,
      },
      required: ['cardId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    scope: 'passes:issue',
    run: async ({ c, issuer }, args) => {
      const parsed = v.safeParse(IssuePassArgs, args)
      if (!parsed.success) {
        return { ok: false, error: 'bad_input' }
      }
      const db = c.get('db')
      const card = await db
        .select()
        .from(cards)
        .where(and(eq(cards.id, parsed.output.cardId), eq(cards.issuerId, issuer.id)))
        .get()
      if (card === undefined) {
        return { ok: false, error: 'not_found' }
      }
      if (!(await spendBudget(db, `mcp-issue:${issuer.id}`, c.get('now')(), ISSUE_BUDGET))) {
        return { ok: false, error: 'rate_limited' }
      }
      const outcome = await issueForCard(c, card, issuer, parsed.output.source ?? null)
      return outcome.ok
        ? {
            ok: true,
            subject: outcome.pass.uid,
            value: {
              memberNumber: outcome.pass.memberNumber,
              passUrl: outcome.pass.passUrls.web,
              uid: outcome.pass.uid,
            },
          }
        : { ok: false, error: outcome.error, subject: card.id }
    },
  },
  {
    name: 'revoke_pass',
    title: 'Revoke pass',
    description:
      'Revoke one pass on chain, for example a cancelled or misused ticket. This cannot be undone: the holder can no longer enter with it, and a replacement is a new pass. Confirm with the user first.',
    inputSchema: {
      type: 'object',
      properties: { uid: { type: 'string', description: 'The uid of a pass from list_passes.' } },
      required: ['uid'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, readOnlyHint: false },
    scope: 'passes:revoke',
    run: async ({ c, issuer }, args) => {
      const parsed = v.safeParse(RevokePassArgs, args)
      const uid = parsed.success ? normalizeUid(parsed.output.uid) : null
      if (uid === null) {
        return { ok: false, error: 'bad_uid' }
      }
      if (!(await spendBudget(c.get('db'), `mcp-revoke:${issuer.id}`, c.get('now')(), REVOKE_BUDGET))) {
        return { ok: false, error: 'rate_limited', subject: uid }
      }
      const outcome = await revokePass(c, uid, { issuerId: issuer.id, kind: 'venue' })
      return outcome.ok
        ? { ok: true, subject: uid, value: { revoked: true, uid } }
        : { ok: false, error: outcome.error, subject: uid }
    },
  },
]
/* oxlint-enable eslint/sort-keys */
