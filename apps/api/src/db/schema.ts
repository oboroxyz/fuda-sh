import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const members = sqliteTable(
  'members',
  {
    attestationUid: text('attestation_uid').primaryKey(),
    createdAt: integer('created_at').notNull(),
    holder: text('holder'),
    level: text('level', { enum: ['bearer', 'signed', 'private'] }).notNull(),
    memberId: text('member_id').notNull().default(''),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    tier: integer('tier').notNull().default(0),
  },
  (t) => [index('members_holder').on(t.holder), index('members_member_id').on(t.memberId)],
)

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

export const announcements = sqliteTable(
  'announcements',
  {
    blockNumber: integer('block_number').notNull(),
    caller: text('caller').notNull(),
    ephemeralPubKey: text('ephemeral_pub_key').notNull(),
    logIndex: integer('log_index').notNull(),
    metadata: text('metadata').notNull(),
    schemeId: integer('scheme_id').notNull(),
    stealthAddress: text('stealth_address').notNull(),
    txHash: text('tx_hash').notNull(),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] })],
)

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
})
