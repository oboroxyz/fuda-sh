import { isNotNull } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const members = sqliteTable(
  'members',
  {
    attestationUid: text('attestation_uid').primaryKey(),
    cardId: text('card_id'),
    createdAt: integer('created_at').notNull(),
    holder: text('holder'),
    level: text('level', { enum: ['bearer', 'signed', 'private'] }).notNull(),
    memberId: text('member_id').notNull().default(''),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    tier: integer('tier').notNull().default(0),
  },
  (t) => [
    index('members_holder').on(t.holder),
    index('members_member_id').on(t.memberId),
    uniqueIndex('members_card_member').on(t.cardId, t.memberId).where(isNotNull(t.cardId)),
  ],
)

export const issuers = sqliteTable('issuers', {
  brandColor: text('brand_color').notNull(),
  createdAt: integer('created_at').notNull(),
  handle: text('handle').notNull().unique(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  operatorAddress: text('operator_address').notNull().unique(),
  tagline: text('tagline').notNull().default(''),
})

export const cards = sqliteTable(
  'cards',
  {
    category: text('category', { enum: ['membership', 'ticket'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    id: text('id').primaryKey(),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    lockScreen: integer('lock_screen').notNull().default(0),
    perk: text('perk').notNull().default(''),
    reward: text('reward').notNull().default(''),
    title: text('title').notNull(),
    validityDays: integer('validity_days'),
    venueLat: real('venue_lat'),
    venueLng: real('venue_lng'),
  },
  (t) => [index('cards_issuer_id').on(t.issuerId)],
)

export const sessions = sqliteTable('sessions', {
  address: text('address').notNull(),
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
  uid: text('uid').notNull(),
})
