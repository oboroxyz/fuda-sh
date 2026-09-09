import type { ReceptionResponse } from '@fuda/sdk'
import { isNotNull } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const members = sqliteTable(
  'members',
  {
    attestationUid: text('attestation_uid').primaryKey(),
    cardId: text('card_id'),
    createdAt: integer('created_at').notNull(),
    holder: text('holder'),
    issuerId: text('issuer_id'),
    level: text('level', { enum: ['bearer', 'signed', 'private'] }).notNull(),
    memberId: text('member_id').notNull().default(''),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    tier: integer('tier').notNull().default(0),
    usageModel: integer('usage_model'),
    validFrom: integer('valid_from'),
    validUntil: integer('valid_until'),
  },
  (t) => [
    index('members_holder').on(t.holder),
    index('members_member_id').on(t.memberId),
    index('members_card_id').on(t.cardId),
    index('members_issuer_created').on(t.issuerId, t.createdAt),
    index('members_issuer_card_status').on(t.issuerId, t.cardId, t.status),
    // Per issuer, not per card: the member number is an ENS label under the
    // issuer (docs/specs/ens-naming.md#member-number).
    uniqueIndex('members_issuer_member').on(t.issuerId, t.memberId).where(isNotNull(t.issuerId)),
  ],
)

export const issuers = sqliteTable('issuers', {
  brandColor: text('brand_color').notNull(),
  createdAt: integer('created_at').notNull(),
  handle: text('handle').notNull().unique(),
  id: text('id').primaryKey(),
  logoPrefix: text('logo_prefix'),
  name: text('name').notNull(),
  operatorAddress: text('operator_address').notNull().unique(),
  tagline: text('tagline').notNull().default(''),
})

export const cards = sqliteTable(
  'cards',
  {
    category: text('category', { enum: ['membership', 'ticket'] }).notNull(),
    claimFrom: integer('claim_from'),
    claimUntil: integer('claim_until'),
    createdAt: integer('created_at').notNull(),
    description: text('description').notNull().default(''),
    id: text('id').primaryKey(),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    lockScreen: integer('lock_screen').notNull().default(0),
    slug: text('slug').notNull().default(''),
    title: text('title').notNull(),
    validFrom: integer('valid_from'),
    validUntil: integer('valid_until'),
    validityDays: integer('validity_days'),
    venueLat: real('venue_lat'),
    venueLng: real('venue_lng'),
  },
  (t) => [index('cards_issuer_id').on(t.issuerId), uniqueIndex('cards_issuer_slug').on(t.issuerId, t.slug)],
)

export const sessions = sqliteTable('sessions', {
  address: text('address').notNull(),
  audience: text('audience', { enum: ['member', 'operator'] })
    .notNull()
    .default('operator'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  issuerId: text('issuer_id'),
  tokenHash: text('token_hash').primaryKey(),
})

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    count: integer('count').notNull(),
    ip: text('ip').notNull(),
    windowStart: integer('window_start').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ip, t.windowStart] })],
)

export const challenges = sqliteTable('challenges', {
  createdAt: integer('created_at').notNull(),
  nonce: text('nonce').primaryKey(),
  uid: text('uid').notNull(),
  usedAt: integer('used_at'),
})

export const slots = sqliteTable(
  'slots',
  {
    consumedAt: integer('consumed_at').notNull(),
    slot: text('slot').notNull(),
    uid: text('uid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.uid, t.slot] })],
)

export const entryLog = sqliteTable('entry_log', {
  at: integer('at').notNull(),
  attendanceUid: text('attendance_uid'),
  decision: text('decision', { enum: ['ADMIT', 'REJECT'] }).notNull(),
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path', { enum: ['qr', 'signature'] }).notNull(),
  reason: text('reason').notNull(),
  receptionId: text('reception_id').unique(),
  uid: text('uid').notNull(),
})

export const stampSettings = sqliteTable('stamp_settings', {
  dailyLimit: integer('daily_limit').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  goal: integer('goal').notNull().default(10),
  issuerId: text('issuer_id')
    .primaryKey()
    .references(() => issuers.id),
})

export const cardStampSettings = sqliteTable('card_stamp_settings', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id),
  dailyLimit: integer('daily_limit').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  goal: integer('goal').notNull().default(10),
})

export const stampCredits = sqliteTable(
  'stamp_credits',
  {
    at: integer('at').notNull(),
    day: text('day').notNull(),
    entryLogId: integer('entry_log_id')
      .notNull()
      .unique()
      .references(() => entryLog.id),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    operatorAddress: text('operator_address').notNull(),
    ordinal: integer('ordinal').notNull(),
    uid: text('uid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.issuerId, t.uid, t.day, t.ordinal] })],
)

export const receptionRequests = sqliteTable('reception_requests', {
  entryLogId: integer('entry_log_id')
    .notNull()
    .references(() => entryLog.id),
  id: text('id').primaryKey(),
  issuerId: text('issuer_id')
    .notNull()
    .references(() => issuers.id),
  response: text('response', { mode: 'json' }).$type<ReceptionResponse>().notNull(),
  uid: text('uid').notNull(),
})

export const logoUploads = sqliteTable(
  'logo_uploads',
  {
    assetPrefix: text('asset_prefix').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    id: text('id').primaryKey(),
    sessionTokenHash: text('session_token_hash').notNull(),
    status: text('status', { enum: ['pending', 'committed'] })
      .notNull()
      .default('pending'),
  },
  (t) => [index('logo_uploads_expires_at').on(t.expiresAt)],
)
