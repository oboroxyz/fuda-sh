import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const ensNames = sqliteTable(
  'ens_names',
  {
    claimTxHash: text('claim_tx_hash'),
    createdAt: integer('created_at').notNull(),
    expiry: integer('expiry'),
    id: integer('id').primaryKey({ autoIncrement: true }),
    issuerHandle: text('issuer_handle').notNull(),
    kind: text('kind', { enum: ['issuer', 'member'] }).notNull(),
    level: text('level', { enum: ['bearer', 'signed', 'private'] }),
    name: text('name').notNull(),
    ownerAddress: text('owner_address').notNull(),
    resolutionCounter: integer('resolution_counter').notNull().default(0),
    rightUid: text('right_uid'),
    status: text('status', {
      enum: ['offchain', 'voucher_issued', 'claimed', 'failed', 'unregistered'],
    }).notNull(),
    stealthMetaAddress: text('stealth_meta_address'),
    targetAddress: text('target_address'),
    unregisterTxHash: text('unregister_tx_hash'),
    updatedAt: integer('updated_at').notNull(),
    voucherIssuedAt: integer('voucher_issued_at'),
  },
  (table) => [
    uniqueIndex('ens_names_name').on(table.name),
    index('ens_names_issuer_handle').on(table.issuerHandle),
    index('ens_names_right_uid').on(table.rightUid),
    index('ens_names_status').on(table.status),
    check('ens_names_kind', sql`${table.kind} IN ('issuer', 'member')`),
    check(
      'ens_names_level',
      sql`${table.level} IS NULL OR ${table.level} IN ('bearer', 'signed', 'private')`,
    ),
    check(
      'ens_names_status_value',
      sql`${table.status} IN ('offchain', 'voucher_issued', 'claimed', 'failed', 'unregistered')`,
    ),
    check('ens_names_resolution_counter', sql`${table.resolutionCounter} >= 0`),
    check(
      'ens_names_shape',
      sql`(
        (${table.kind} = 'issuer' AND ${table.rightUid} IS NULL AND ${table.level} IS NULL AND ${table.stealthMetaAddress} IS NULL AND ${table.targetAddress} IS NOT NULL)
        OR
        (${table.kind} = 'member' AND ${table.rightUid} IS NOT NULL AND ${table.level} IS NOT NULL AND (
          (${table.level} = 'private' AND ${table.targetAddress} IS NULL AND ${table.stealthMetaAddress} IS NOT NULL)
          OR
          (${table.level} != 'private' AND ${table.targetAddress} IS NOT NULL AND ${table.stealthMetaAddress} IS NULL)
        ))
      )`,
    ),
  ],
)

export const stealthResolutions = sqliteTable(
  'stealth_resolutions',
  {
    ensNameId: integer('ens_name_id')
      .notNull()
      .references(() => ensNames.id, { onDelete: 'cascade' }),
    ephemeralPublicKey: text('ephemeral_public_key').notNull(),
    expiresAt: integer('expires_at'),
    id: integer('id').primaryKey({ autoIncrement: true }),
    nonceCounter: integer('nonce_counter').notNull(),
    resolvedAt: integer('resolved_at').notNull(),
    stealthAddress: text('stealth_address').notNull(),
    usedAt: integer('used_at'),
    viewTag: text('view_tag').notNull(),
  },
  (table) => [
    uniqueIndex('stealth_resolutions_name_nonce').on(table.ensNameId, table.nonceCounter),
    uniqueIndex('stealth_resolutions_address').on(table.stealthAddress),
    index('stealth_resolutions_ens_name_id').on(table.ensNameId),
  ],
)

export type EnsNameRow = typeof ensNames.$inferSelect
export type NewEnsNameRow = typeof ensNames.$inferInsert
export type StealthResolutionRow = typeof stealthResolutions.$inferSelect
export type NewStealthResolutionRow = typeof stealthResolutions.$inferInsert
