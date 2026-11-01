import { CardBody, CARD_CATEGORIES } from '@fuda/sdk'
import type { CardView, ConnectedAppScope } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'

import type { Db } from '../db/client.ts'
import { cards, issuers } from '../db/schema.ts'
import { insertCard } from '../issuers/create.ts'
import { fieldErrorFor } from '../issuers/field-error.ts'
import { cardView, publicUrlFor } from '../issuers/views.ts'

// docs/specs/mcp.md#tools — every tool acts for the token's one issuer.
export interface ToolContext {
  db: Db
  issuer: typeof issuers.$inferSelect
  now: number
  publicBaseUrl: string
}

export type ToolOutcome = { ok: true; value: object } | { ok: false; error: string }

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

const withClaimUrl = (context: ToolContext, card: CardView): CardView & { claimUrl: string } => ({
  ...card,
  claimUrl: `${publicUrlFor(context.publicBaseUrl, context.issuer.handle)}/${card.slug}`,
})

const unixOrNull = { minimum: 0, type: ['integer', 'null'] }

/* oxlint-disable eslint/sort-keys -- tool definitions read in the order MCP documents them */
export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'list_cards',
    title: 'List cards',
    description:
      "List this profile's cards, oldest first. Each card has a claimUrl: the public page where a person gets a pass.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    scope: 'cards:read',
    run: async (context) => {
      const rows = await context.db
        .select()
        .from(cards)
        .where(eq(cards.issuerId, context.issuer.id))
        .orderBy(cards.createdAt)
      return {
        ok: true,
        value: {
          issuer: { handle: context.issuer.handle, name: context.issuer.name },
          cards: rows.map((row) => withClaimUrl(context, cardView(row, context.now))),
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
        category: { type: 'string', enum: CARD_CATEGORIES },
        title: { type: 'string', minLength: 1, maxLength: 60 },
        slug: {
          type: 'string',
          description: "The card's path in its public URL: lowercase ASCII, digits and single hyphens.",
        },
        description: { type: 'string' },
        lockScreen: { type: 'boolean' },
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
      const card = await insertCard(context.db, context.issuer.id, parsed.output, context.now)
      return card === null
        ? { ok: false, error: 'slug_taken' }
        : { ok: true, value: { card: withClaimUrl(context, cardView(card, context.now)) } }
    },
  },
]
/* oxlint-enable eslint/sort-keys */
