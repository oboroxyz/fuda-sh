import type { MemberSecretResponse, MemberVaultView } from '@fuda/sdk'
import { eq, sql } from 'drizzle-orm'
import * as v from 'valibot'

import type { Db } from '../db/client.ts'
import { memberSecretCopies, memberSecretOutcomes, memberVaults, passkeys } from '../db/schema.ts'

// docs/specs/pass-types-and-flows.md#sensitive-use. Everything stored here is ciphertext
// only the member's device can open. A stolen session can damage it but cannot read it.

const Transports = v.array(v.string())

const transportsOf = (stored: string): string[] => {
  const parsed = v.safeParse(Transports, JSON.parse(stored))
  return parsed.success ? parsed.output : []
}

export const memberSecret = async (
  db: Db,
  rpId: string,
  accountId: string,
): Promise<MemberSecretResponse> => {
  const [held, copies] = await Promise.all([
    db
      .select({ id: passkeys.credentialId, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.accountId, accountId)),
    db
      .select({
        ciphertext: memberSecretCopies.ciphertext,
        credentialId: memberSecretCopies.credentialId,
        iv: memberSecretCopies.iv,
      })
      .from(memberSecretCopies)
      .where(eq(memberSecretCopies.accountId, accountId)),
  ])
  const withCopy = new Set(copies.map((copy) => copy.credentialId))
  return {
    allowCredentials: held
      .filter((row) => copies.length === 0 || withCopy.has(row.id))
      .map((row) => ({ id: row.id, transports: transportsOf(row.transports) })),
    copies,
    rpId,
  }
}

export interface SecretCopyInput {
  ciphertext: string
  credentialId: string
  first: boolean
  iv: string
}

// One statement, so two devices enrolling at once cannot each start a secret of their own:
// `first` holds only while the account has no copy, and any later copy only once it has.
// The credential must be the account's own, and a copy is never replaced.
export const addSecretCopy = async (
  raw: D1Database,
  accountId: string,
  copy: SecretCopyInput,
  now: number,
): Promise<boolean> =>
  (await raw
    .prepare(
      `INSERT INTO member_secret_copies (account_id, credential_id, iv, ciphertext, created_at)
       SELECT account_id, credential_id, ?1, ?2, ?3
       FROM passkeys
       WHERE credential_id = ?4 AND account_id = ?5
         AND EXISTS (SELECT 1 FROM member_secret_copies WHERE account_id = ?5) = ?6
       ON CONFLICT DO NOTHING
       RETURNING credential_id AS credentialId`,
    )
    .bind(copy.iv, copy.ciphertext, now, copy.credentialId, accountId, copy.first ? 0 : 1)
    .first<{ credentialId: string }>()) !== null

// The member's way back once no passkey opens the secret: what is here is then useless, and
// while it stays, no new secret can start, so no new pass can be claimed on this account.
export const clearSecret = async (db: Db, accountId: string): Promise<void> => {
  await db.batch([
    db.delete(memberSecretCopies).where(eq(memberSecretCopies.accountId, accountId)),
    db.delete(memberVaults).where(eq(memberVaults.accountId, accountId)),
  ])
}

export const readVault = async (db: Db, accountId: string): Promise<MemberVaultView | null> =>
  (await db
    .select({ ciphertext: memberVaults.ciphertext, iv: memberVaults.iv, version: memberVaults.version })
    .from(memberVaults)
    .where(eq(memberVaults.accountId, accountId))
    .get()) ?? null

export interface VaultInput {
  ciphertext: string
  expectedVersion: number
  iv: string
}

// The last writer's ciphertext stands, but only a writer that has read the current version
// may write. Losing a salt loses a pass, so a stale device is sent back to read and merge.
export const writeVault = async (
  db: Db,
  accountId: string,
  input: VaultInput,
  now: number,
): Promise<number | null> => {
  const version = input.expectedVersion + 1
  const written = await db
    .insert(memberVaults)
    .values({ accountId, ciphertext: input.ciphertext, iv: input.iv, updatedAt: now, version })
    .onConflictDoUpdate({
      set: { ciphertext: input.ciphertext, iv: input.iv, updatedAt: now, version },
      setWhere: eq(memberVaults.version, input.expectedVersion),
      target: memberVaults.accountId,
    })
    .returning({ version: memberVaults.version })
    .get()
  return written?.version ?? null
}

export const countOutcome = async (db: Db, outcome: 'no_prf' | 'prf'): Promise<void> => {
  await db
    .insert(memberSecretOutcomes)
    .values({ outcome, total: 1 })
    .onConflictDoUpdate({
      set: { total: sql`${memberSecretOutcomes.total} + 1` },
      target: memberSecretOutcomes.outcome,
    })
}
