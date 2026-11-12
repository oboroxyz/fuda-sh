import type { PassBranding } from '@fuda/pass'
import { asHex, formatMemberNumber, normalizeUid } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { cards, issuers } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse } from '../json.ts'
import { artworkUrlFor, logoUrlFor } from '../media/logo.ts'
import type { PassRow } from './pass-view.ts'
import { loadWalletMember } from './wallet-members.ts'
import { walletValidity } from './wallet-status.ts'

export type PassRowResult = { ok: true; row: PassRow } | { ok: false; res: Response }

// Branding and the issuer's asset prefix come from one cards ⋈ issuers row: the
// Apple builder needs the prefix, the other two builders only the branding.
interface CardBranding {
  branding: PassBranding | null
  logoPrefix: string | null
  posterPrefix: string | null
  artworkPrefix: string | null
}

const NO_BRANDING: CardBranding = {
  artworkPrefix: null,
  branding: null,
  logoPrefix: null,
  posterPrefix: null,
}

export const restoreUrl = (publicBaseUrl: string, handle: string, slug: string, uid: Hex): string =>
  `${publicBaseUrl}/@${handle}${slug === '' ? '' : `/${slug}`}?uid=${uid}`

// The card behind a self-serve right, or null when the row was admin-issued
// (or the card is gone): the pass then keeps the plain fuda look.
const cardBrandingOf = async (
  db: Db,
  cardId: string | null,
  memberId: string,
  issuedAt: number,
  baseUrl: string,
  publicBaseUrl: string,
  uid: Hex,
): Promise<CardBranding> => {
  if (cardId === null) {
    return NO_BRANDING
  }
  const found = await db
    .select({
      artworkPrefix: cards.artworkPrefix,
      brandColor: issuers.brandColor,
      category: cards.category,
      handle: issuers.handle,
      lockScreen: cards.lockScreen,
      logoPrefix: issuers.logoPrefix,
      name: issuers.name,
      posterPrefix: cards.posterPrefix,
      slug: cards.slug,
      title: cards.title,
      venueLat: cards.venueLat,
      venueLng: cards.venueLng,
    })
    .from(cards)
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .where(eq(cards.id, cardId))
    .get()
  if (found === undefined) {
    return NO_BRANDING
  }
  const venue =
    found.lockScreen === 1 && found.venueLat !== null && found.venueLng !== null
      ? { lat: found.venueLat, lng: found.venueLng }
      : null
  return {
    artworkPrefix: found.artworkPrefix,
    branding: {
      artworkUrl: artworkUrlFor(baseUrl, found.artworkPrefix),
      brandColor: found.brandColor,
      cardTitle: found.title,
      category: found.category,
      issuedAt,
      issuerName: found.name,
      // Absolute and versioned, because Google Wallet fetches it and caches it,
      // and a saved pass outlives the request that made it.
      logoUrl: logoUrlFor(baseUrl, found.handle, found.logoPrefix),
      // The public link, so a wallet pass leads back to the member page for this
      // card — where badging lives. A legacy Card with no slug keeps the bare
      // handle, which opens its sole claimable Card
      // (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
      // It carries the uid so a new device opens this pass rather than offering a second
      // one. The uid is already in the pass's barcode, so this shows it to nobody new.
      manageUrl: restoreUrl(publicBaseUrl, found.handle, found.slug, uid),
      memberNumber: formatMemberNumber(memberId),
      venue,
    },
    logoPrefix: found.logoPrefix,
    posterPrefix: found.posterPrefix,
  }
}

// The one lookup the three /pass routes share. Order matters and is part of
// the contract: 400 (bad uid) → 404 (no row) → only then the platform check the
// caller makes.
export const loadPassRow = async (c: Context<AppEnv>, rawUid: string): Promise<PassRowResult> => {
  // Every pass response carries the live status (or names a live secret), so
  // none of them may be cached — including the 404s and 501s.
  c.header('cache-control', 'no-store')
  const uid = normalizeUid(rawUid)
  if (uid === null) {
    return { ok: false, res: errorResponse(c, 'bad_uid', 400) }
  }
  const row = await loadWalletMember(c.get('db'), uid)
  if (row === undefined) {
    return { ok: false, res: errorResponse(c, 'not_found', 404) }
  }
  const { artworkPrefix, posterPrefix, branding, logoPrefix } = await cardBrandingOf(
    c.get('db'),
    row.cardId,
    row.memberId,
    row.createdAt,
    c.env.API_BASE_URL,
    c.env.PUBLIC_BASE_URL,
    uid,
  )
  return {
    ok: true,
    // Written only from checksummed addresses (bearerHolder / getAddress), so a
    // null here means a malformed row, which the pass treats as "no holder".
    row: {
      artworkPrefix,
      branding,
      holder: row.holder === null ? null : asHex(row.holder, 20),
      level: row.level,
      logoPrefix,
      posterPrefix,
      tier: row.tier,
      uid,
      validity: await walletValidity(c.get('db'), uid, row, c.get('now')()),
    },
  }
}
