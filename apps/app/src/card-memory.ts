import { asHex, isIssuerHandle, isMemberNumber, isUid, normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'

import type { PassMemoryStorage } from './pass-memory.ts'

export const CARD_MEMORY_KEY = 'fuda.cards.v1'

// The card this device already holds for a venue, so revisiting /@<handle>
// shows it again instead of issuing a second one.
export interface CardMemoryEntry {
  uid: Hex
  holder: Hex
  memberNumber: string
  issuedAt: number
}

export type CardMemory = Record<string, CardMemoryEntry>

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this validator is the JSON trust boundary
const isEntry = (value: unknown): value is CardMemoryEntry => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  if (!('uid' in value) || !('holder' in value) || !('memberNumber' in value) || !('issuedAt' in value)) {
    return false
  }

  return (
    Object.keys(value).length === 4 &&
    typeof value.uid === 'string' &&
    isUid(value.uid) &&
    normalizeUid(value.uid) === value.uid &&
    typeof value.holder === 'string' &&
    asHex(value.holder, 20) !== null &&
    typeof value.memberNumber === 'string' &&
    isMemberNumber(value.memberNumber) &&
    typeof value.issuedAt === 'number' &&
    Number.isFinite(value.issuedAt) &&
    value.issuedAt >= 0
  )
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this validator is the JSON trust boundary
const isMemory = (value: unknown): value is CardMemory =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.entries(value).every(([handle, entry]) => isIssuerHandle(handle) && isEntry(entry))

export const readCardMemory = (storage?: PassMemoryStorage): CardMemory => {
  try {
    const stored = (storage ?? globalThis.localStorage).getItem(CARD_MEMORY_KEY)
    if (stored === null) {
      return {}
    }
    const decoded: unknown = JSON.parse(stored)
    return isMemory(decoded) ? { ...decoded } : {}
  } catch {
    return {}
  }
}

export const readCard = (handle: string, storage?: PassMemoryStorage): CardMemoryEntry | null =>
  readCardMemory(storage)[handle] ?? null

export const rememberCard = (
  handle: string,
  card: Pick<CardMemoryEntry, 'holder' | 'memberNumber' | 'uid'>,
  storage?: PassMemoryStorage,
  issuedAt = Date.now(),
): CardMemory | null => {
  try {
    const uid = normalizeUid(card.uid)
    const holder = asHex(card.holder, 20)
    if (uid === null || holder === null || !isIssuerHandle(handle) || !isMemberNumber(card.memberNumber)) {
      return null
    }
    const entry: CardMemoryEntry = { holder, issuedAt, memberNumber: card.memberNumber, uid }
    const remembered = { ...readCardMemory(storage), [handle]: entry } satisfies CardMemory
    const target = storage ?? globalThis.localStorage
    target.setItem(CARD_MEMORY_KEY, JSON.stringify(remembered))
    return remembered
  } catch {
    return null
  }
}
