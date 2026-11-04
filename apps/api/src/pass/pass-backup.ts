import type { PassBackup } from '@fuda/sdk'
import { asHex, toQr } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Hex } from 'viem'

import { ZERO_ADDRESS } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cards, issuers, members, offchainAttestations, offchainRoots } from '../db/schema.ts'
import { merkleProof } from '../eas/merkle.ts'
import { signedJsonOf } from '../eas/offchain.ts'
import type { AppEnv } from '../env.ts'
import { restoreUrl } from './pass-row.ts'

const proofOf = async (db: Db, uid: Hex, root: string): Promise<PassBackup['proof']> => {
  const row = await db.select().from(offchainRoots).where(eq(offchainRoots.root, root)).get()
  const rootHex = asHex(root, 32)
  if (row?.anchoredAt === null || row === undefined || rootHex === null) {
    return null
  }
  const peers = await db
    .select({ uid: offchainAttestations.uid })
    .from(offchainAttestations)
    .where(eq(offchainAttestations.root, root))
  const uids = peers.map((peer) => asHex(peer.uid, 32)).filter((peer) => peer !== null)
  const path = merkleProof(uids, uid)
  return path === null ? null : { anchoredAt: row.anchoredAt, path, root: rootHex }
}

export const passBackup = async (c: Context<AppEnv>, uid: Hex, holder: Hex | null): Promise<PassBackup> => {
  const db = c.get('db')
  const member = await db
    .select({ handle: issuers.handle, memberId: members.memberId, slug: cards.slug })
    .from(members)
    .leftJoin(cards, eq(cards.id, members.cardId))
    .leftJoin(issuers, eq(issuers.id, cards.issuerId))
    .where(eq(members.attestationUid, uid))
    .get()
  const offchain = await db.select().from(offchainAttestations).where(eq(offchainAttestations.uid, uid)).get()
  const handle = member?.handle ?? null
  const slug = member?.slug ?? null
  return {
    attestation: offchain === undefined ? null : signedJsonOf(offchain.signed),
    handle,
    holder: holder ?? ZERO_ADDRESS,
    memberNumber: member?.memberId ?? '',
    proof: offchain?.root === null || offchain === undefined ? null : await proofOf(db, uid, offchain.root),
    qr: toQr(uid),
    restoreUrl: handle === null ? null : restoreUrl(c.env.PUBLIC_BASE_URL, handle, slug ?? '', uid),
    slug,
    uid,
    version: 1,
  }
}
