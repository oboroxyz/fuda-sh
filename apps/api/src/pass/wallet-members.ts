import type { Hex } from '@fuda/sdk'
import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { members } from '../db/schema.ts'

// Sensitive rights never leave the vault through a Wallet route or notification.
// All Wallet member queries use this predicate, including installed Apple registrations.
export const WALLET_MEMBER_FILTER = `NOT EXISTS (
  SELECT 1 FROM cards WHERE cards.id = members.card_id AND cards.identity = 'sensitive'
)`

export const loadWalletMember = async (db: Db, uid: Hex) =>
  await db
    .select()
    .from(members)
    .where(and(eq(members.attestationUid, uid), sql.raw(WALLET_MEMBER_FILTER)))
    .get()
