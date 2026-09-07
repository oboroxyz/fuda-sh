import type { PassBranding } from '@fuda/pass'
import { asHex, formatMemberNumber, normalizeUid } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'

import type { Db } from '../db/client.ts'
import { cards, issuers, members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse } from '../json.ts'
import type { PassRow } from './pass-view.ts'

export type PassRowResult = { ok: true; row: PassRow } | { ok: false; res: Response }

// The card behind a self-serve right, or null when the row was admin-issued
// (or the card is gone): the pass then keeps the plain fuda look.
const brandingOf = async (db: Db, cardId: string | null, memberId: string): Promise<PassBranding | null> => {
  if (cardId === null) {
    return null
  }
  const found = await db
    .select({
      brandColor: issuers.brandColor,
      lockScreen: cards.lockScreen,
      name: issuers.name,
      title: cards.title,
      venueLat: cards.venueLat,
      venueLng: cards.venueLng,
    })
    .from(cards)
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .where(eq(cards.id, cardId))
    .get()
  if (found === undefined) {
    return null
  }
  const venue =
    found.lockScreen === 1 && found.venueLat !== null && found.venueLng !== null
      ? { lat: found.venueLat, lng: found.venueLng }
      : null
  return {
    brandColor: found.brandColor,
    cardTitle: found.title,
    issuerName: found.name,
    memberNumber: formatMemberNumber(memberId),
    venue,
  }
}

// The one lookup the three /pass routes share. Order matters and is part of
// the contract: 400 (bad uid) → 404 (no row) → 404 (+Private: there is no pass
// for a one-time stealth holder) → only then the platform check the caller
// makes. A private row therefore never reveals whether a wallet platform is
// configured.
export const loadPassRow = async (c: Context<AppEnv>, rawUid: string): Promise<PassRowResult> => {
  // Every pass response carries the live status (or names a live secret), so
  // none of them may be cached — including the 404s and 501s.
  c.header('cache-control', 'no-store')
  const uid = normalizeUid(rawUid)
  if (uid === null) {
    return { ok: false, res: errorResponse(c, 'bad_uid', 400) }
  }
  const row = await c.get('db').select().from(members).where(eq(members.attestationUid, uid)).get()
  if (row === undefined) {
    return { ok: false, res: errorResponse(c, 'not_found', 404) }
  }
  // A +Private right has no pass (docs/specs/pass-types-and-flows.md#passes: the private /issue response carries
  // no passUrls); its holder is a one-time stealth address only the member can
  // recover. None of the three endpoints exists for it.
  if (row.level === 'private') {
    return { ok: false, res: errorResponse(c, 'not_found', 404) }
  }
  return {
    ok: true,
    // Written only from checksummed addresses (bearerHolder / getAddress), so a
    // null here means a malformed row, which the pass treats as "no holder".
    row: {
      branding: await brandingOf(c.get('db'), row.cardId, row.memberId),
      holder: row.holder === null ? null : asHex(row.holder, 20),
      level: row.level,
      tier: row.tier,
      uid,
    },
  }
}
