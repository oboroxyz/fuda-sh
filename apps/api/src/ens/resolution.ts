import { asMetaAddress, generateStealthAddress } from '@fuda/stealth-address'
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { bytesToHex, hexToBytes } from 'viem'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { ensNames, stealthResolutions } from './schema.ts'

const GATEWAY_SECRET = /^0x[0-9a-f]{64}$/iu
const SECP256K1_ORDER =
  0xff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_fe_ba_ae_dc_e6_af_48_a0_3b_bf_d2_5e_8c_d0_36_41_41n

interface EphemeralKeyInput {
  counter: number
  gatewaySecret: string
  name: string
}

const parseGatewaySecret = (secret: string): Uint8Array => {
  if (!GATEWAY_SECRET.test(secret)) {
    throw new Error('invalid ENS gateway secret')
  }
  const normalized: Hex = `0x${secret.slice(2)}`
  return hexToBytes(normalized)
}

const counterBytes = (counter: number): Uint8Array => {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error('invalid ENS resolution counter')
  }
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter))
  return bytes
}

const scalarBytes = (value: bigint): Uint8Array => hexToBytes(`0x${value.toString(16).padStart(64, '0')}`)

export const deriveResolutionEphemeralKey = async (input: EphemeralKeyInput): Promise<Uint8Array> => {
  const secret = parseGatewaySecret(input.gatewaySecret)
  const name = new TextEncoder().encode(input.name)
  const message = new Uint8Array(name.length + 8)
  message.set(name)
  message.set(counterBytes(input.counter), name.length)
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret).buffer,
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  const scalar = (BigInt(bytesToHex(digest)) % (SECP256K1_ORDER - 1n)) + 1n
  return scalarBytes(scalar)
}

interface AllocateInput {
  ensNameId: number
  expiresAt?: number
  gatewaySecret: string
  name: string
  now: number
}

export interface AllocatedStealthResolution {
  ephemeralPublicKey: Hex
  expiresAt: number | null
  nonceCounter: number
  stealthAddress: Hex
  viewTag: number
}

export const allocateStealthResolution = async (
  db: Db,
  input: AllocateInput,
): Promise<AllocatedStealthResolution | null> => {
  parseGatewaySecret(input.gatewaySecret)

  const [reservation] = await db
    .update(ensNames)
    .set({
      resolutionCounter: sql`${ensNames.resolutionCounter} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(ensNames.id, input.ensNameId),
        eq(ensNames.name, input.name),
        eq(ensNames.level, 'private'),
        inArray(ensNames.status, ['offchain', 'claimed']),
        or(isNull(ensNames.expiry), gte(ensNames.expiry, input.now)),
      ),
    )
    .returning({
      nonceCounter: sql<number>`${ensNames.resolutionCounter} - 1`,
      stealthMetaAddress: ensNames.stealthMetaAddress,
    })
  if (reservation?.stealthMetaAddress === null || reservation === undefined) {
    return null
  }
  const metaAddress = asMetaAddress(reservation.stealthMetaAddress)
  if (metaAddress === null) {
    return null
  }

  const ephemeralKey = await deriveResolutionEphemeralKey({
    counter: reservation.nonceCounter,
    gatewaySecret: input.gatewaySecret,
    name: input.name,
  })
  const generated = generateStealthAddress(metaAddress, ephemeralKey)
  const viewTag = `0x${generated.viewTag.toString(16).padStart(2, '0')}`
  await db.insert(stealthResolutions).values({
    ensNameId: input.ensNameId,
    ephemeralPublicKey: generated.ephemeralPublicKey,
    expiresAt: input.expiresAt,
    nonceCounter: reservation.nonceCounter,
    resolvedAt: input.now,
    stealthAddress: generated.stealthAddress,
    viewTag,
  })
  return {
    ephemeralPublicKey: generated.ephemeralPublicKey,
    expiresAt: input.expiresAt ?? null,
    nonceCounter: reservation.nonceCounter,
    stealthAddress: generated.stealthAddress,
    viewTag: generated.viewTag,
  }
}
