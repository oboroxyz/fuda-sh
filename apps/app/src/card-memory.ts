import { asHex, isCardSlugReference, isIssuerHandle, isMemberNumber, isUid, normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'

import type { PassMemoryStorage } from './pass-memory.ts'

export const CARD_MEMORY_KEY = 'fuda.cards.v2'

// One card this device already holds, so revisiting its address shows it again
// instead of issuing a second one. A venue may publish several cards and a
// member may legitimately hold more than one of them, so the record is keyed by
// venue *and* card rather than by venue alone.
export interface CardMemoryEntry {
  uid: Hex
  holder: Hex
  memberNumber: string
  issuedAt: number
}

export type CardMemory = Record<string, CardMemoryEntry>

// The record stays a flat `Record<string, CardMemoryEntry>` so the JSON trust
// boundary below can validate it in one pass. Neither a handle nor a slug may
// contain a slash, so the two halves of a key are unambiguous.
export const cardKey = (handle: string, slug: string): string => `${handle}/${slug}`

const isCardKey = (key: string): boolean => {
  const [handle, slug, ...rest] = key.split('/')
  return (
    rest.length === 0 &&
    handle !== undefined &&
    slug !== undefined &&
    isIssuerHandle(handle) &&
    isCardSlugReference(slug)
  )
}

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
  Object.entries(value).every(([key, entry]) => isCardKey(key) && isEntry(entry))

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

export const readCard = (handle: string, slug: string, storage?: PassMemoryStorage): CardMemoryEntry | null =>
  readCardMemory(storage)[cardKey(handle, slug)] ?? null

export const rememberCard = (
  handle: string,
  slug: string,
  card: Pick<CardMemoryEntry, 'holder' | 'memberNumber' | 'uid'>,
  storage?: PassMemoryStorage,
  issuedAt = Date.now(),
): CardMemory | null => {
  try {
    const uid = normalizeUid(card.uid)
    const holder = asHex(card.holder, 20)
    if (
      uid === null ||
      holder === null ||
      !isIssuerHandle(handle) ||
      !isCardSlugReference(slug) ||
      !isMemberNumber(card.memberNumber)
    ) {
      return null
    }
    const entry: CardMemoryEntry = { holder, issuedAt, memberNumber: card.memberNumber, uid }
    const remembered = { ...readCardMemory(storage), [cardKey(handle, slug)]: entry } satisfies CardMemory
    const target = storage ?? globalThis.localStorage
    target.setItem(CARD_MEMORY_KEY, JSON.stringify(remembered))
    return remembered
  } catch {
    return null
  }
}
