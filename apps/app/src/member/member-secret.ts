import { base64URLStringToBuffer, bufferToBase64URLString } from '@simplewebauthn/browser'
import * as v from 'valibot'
import { bytesToHex } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PrivateKeyAccount } from 'viem/accounts'

// docs/specs/pass-types-and-flows.md#sensitive-use. The member secret and everything made
// from it stays on the device. These strings fix what each derived key is for, so changing
// one loses every Sensitive pass.
const WRAP_INFO = 'fuda.sh/member-secret/wrap/v1'
const VAULT_INFO = 'fuda.sh/member-secret/vault/v1'
const PASS_KEY_INFO = 'fuda.sh/member-secret/pass-key/v1'

const SECRET_BYTES = 32
const IV_BYTES = 12
const EMPTY = new Uint8Array(0)

type Bytes = Uint8Array<ArrayBuffer>

const randomBytes = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length))

const encoded = (text: string): Bytes => new TextEncoder().encode(text)

export interface Sealed {
  ciphertext: string
  iv: string
}

const hkdfBase = async (material: Bytes): Promise<CryptoKey> =>
  await crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveBits', 'deriveKey'])

const aesKey = async (material: Bytes, info: string): Promise<CryptoKey> =>
  await crypto.subtle.deriveKey(
    { hash: 'SHA-256', info: encoded(info), name: 'HKDF', salt: EMPTY },
    await hkdfBase(material),
    { length: 256, name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )

const seal = async (key: CryptoKey, plain: Bytes): Promise<Sealed> => {
  const iv = randomBytes(IV_BYTES)
  const ciphertext = await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, plain)
  return { ciphertext: bufferToBase64URLString(ciphertext), iv: bufferToBase64URLString(iv.buffer) }
}

// null for anything this key did not seal, which is what AES-GCM's tag is for.
const open = async (key: CryptoKey, sealed: Sealed): Promise<Bytes | null> => {
  try {
    const plain = await crypto.subtle.decrypt(
      { iv: base64URLStringToBuffer(sealed.iv), name: 'AES-GCM' },
      key,
      base64URLStringToBuffer(sealed.ciphertext),
    )
    return new Uint8Array(plain)
  } catch {
    return null
  }
}

export const newMemberSecret = (): Bytes => randomBytes(SECRET_BYTES)

export const wrapSecret = async (secret: Bytes, prfOutput: Bytes): Promise<Sealed> =>
  await seal(await aesKey(prfOutput, WRAP_INFO), secret)

export const unwrapSecret = async (copy: Sealed, prfOutput: Bytes): Promise<Bytes | null> =>
  await open(await aesKey(prfOutput, WRAP_INFO), copy)

export const newPassSalt = (): string => bufferToBase64URLString(randomBytes(SECRET_BYTES).buffer)

// One key per pass, so nothing a gate or an Issuer sees ties two passes to one person. The
// salt is what makes it this pass's key, and the vault is the only place it is kept.
export const passKeyFrom = async (secret: Bytes, salt: string): Promise<PrivateKeyAccount> => {
  const bits = await crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      info: encoded(PASS_KEY_INFO),
      name: 'HKDF',
      salt: base64URLStringToBuffer(salt),
    },
    await hkdfBase(secret),
    256,
  )
  const key: Hex = bytesToHex(new Uint8Array(bits))
  return privateKeyToAccount(key)
}

const VaultEntry = v.object({
  cardTitle: v.string(),
  salt: v.string(),
  uid: v.custom<Hex>((value) => typeof value === 'string' && /^0x[0-9a-f]{64}$/iu.test(value)),
  venue: v.string(),
})
export type VaultEntry = v.InferOutput<typeof VaultEntry>

const VaultEntries = v.array(VaultEntry)

export const sealEntries = async (entries: readonly VaultEntry[], secret: Bytes): Promise<Sealed> =>
  await seal(await aesKey(secret, VAULT_INFO), encoded(JSON.stringify(entries)))

// null when this secret did not seal it, so a caller never writes over what it could not read.
export const openEntries = async (sealed: Sealed, secret: Bytes): Promise<VaultEntry[] | null> => {
  const plain = await open(await aesKey(secret, VAULT_INFO), sealed)
  if (plain === null) {
    return null
  }
  try {
    const parsed = v.safeParse(VaultEntries, JSON.parse(new TextDecoder().decode(plain)))
    return parsed.success ? parsed.output : null
  } catch {
    return null
  }
}

export const mergeEntries = (
  current: readonly VaultEntry[],
  added: readonly VaultEntry[],
): VaultEntry[] => {
  const known = new Set(current.map((entry) => entry.uid))
  return [...current, ...added.filter((entry) => !known.has(entry.uid))]
}
