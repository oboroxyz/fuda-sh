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
    level: text('level', { enum: ['bearer', 'signed'] }),
    name: text('name').notNull(),
    ownerAddress: text('owner_address').notNull(),
    rightUid: text('right_uid'),
    status: text('status', {
      enum: ['offchain', 'voucher_issued', 'claimed', 'failed', 'unregistered'],
    }).notNull(),
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
    check('ens_names_level', sql`${table.level} IS NULL OR ${table.level} IN ('bearer', 'signed')`),
    check(
      'ens_names_status_value',
      sql`${table.status} IN ('offchain', 'voucher_issued', 'claimed', 'failed', 'unregistered')`,
    ),
    check(
      'ens_names_shape',
      sql`(
        (${table.kind} = 'issuer' AND ${table.rightUid} IS NULL AND ${table.level} IS NULL AND ${table.targetAddress} IS NOT NULL)
        OR
        (${table.kind} = 'member' AND ${table.rightUid} IS NOT NULL AND ${table.level} IS NOT NULL AND ${table.targetAddress} IS NOT NULL)
      )`,
    ),
  ],
)
