import type { StampSettings, StampSummary } from '@fuda/sdk'
import { and, count, eq, isNotNull, ne, sql } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { cards, cardStampSettings, members, stampCredits } from '../db/schema.ts'

export const japanDay = (now: number): string => new Date((now + 9 * 3600) * 1000).toISOString().slice(0, 10)

export const readStampSettings = async (db: Db, cardId: string): Promise<StampSettings> => {
  const row = await db.select().from(cardStampSettings).where(eq(cardStampSettings.cardId, cardId)).get()
  return { dailyLimit: row?.dailyLimit ?? 1, enabled: row?.enabled ?? false, goal: row?.goal ?? 10 }
}

export const readStampSummary = async (db: Db, uid: string, now: number): Promise<StampSummary | null> => {
  // One snapshot: simultaneous reception cannot make today's count exceed the
  // returned total or combine counts with settings from another query.
  const row = await db
    .select({
      dailyLimit: cardStampSettings.dailyLimit,
      enabled: cardStampSettings.enabled,
      goal: cardStampSettings.goal,
      today: sql<number>`coalesce(sum(case when ${stampCredits.day} = ${japanDay(now)} then 1 else 0 end), 0)`,
      total: count(stampCredits.entryLogId),
    })
    .from(members)
    .leftJoin(cards, and(eq(cards.id, members.cardId), eq(cards.issuerId, members.issuerId)))
    .leftJoin(cardStampSettings, eq(cardStampSettings.cardId, cards.id))
    .leftJoin(
      stampCredits,
      and(eq(stampCredits.issuerId, members.issuerId), eq(stampCredits.uid, members.attestationUid)),
    )
    .where(and(eq(members.attestationUid, uid), isNotNull(members.issuerId), ne(members.level, 'private')))
    .groupBy(members.attestationUid)
    .get()
  if (row === undefined) {
    return null
  }
  return {
    dailyLimit: row.dailyLimit ?? 1,
    enabled: row.enabled ?? false,
    goal: row.goal ?? 10,
    today: row.today,
    total: row.total,
  }
}
