import { asHex, isUid, normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'

export const PASS_MEMORY_KEY = 'fuda.passes.v1'

export interface PassMemoryEntry {
  uid: Hex
  holder: Hex
  addedAt: number
}

export interface PassMemoryStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this validator is the JSON trust boundary
const isEntry = (value: unknown): value is PassMemoryEntry => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  if (!('uid' in value) || !('holder' in value) || !('addedAt' in value)) {
    return false
  }

  const keys = Object.keys(value)
  return (
    keys.length === 3 &&
    keys.includes('uid') &&
    keys.includes('holder') &&
    keys.includes('addedAt') &&
    typeof value.uid === 'string' &&
    isUid(value.uid) &&
    normalizeUid(value.uid) === value.uid &&
    typeof value.holder === 'string' &&
    asHex(value.holder, 20) !== null &&
    typeof value.addedAt === 'number' &&
    Number.isFinite(value.addedAt) &&
    value.addedAt >= 0
  )
}

export const readPassMemory = (storage?: PassMemoryStorage): PassMemoryEntry[] => {
  try {
    const stored = (storage ?? globalThis.localStorage).getItem(PASS_MEMORY_KEY)
    if (stored === null) {
      return []
    }

    const decoded: unknown = JSON.parse(stored)
    if (!Array.isArray(decoded) || !decoded.every(isEntry)) {
      return []
    }

    const sorted = [...decoded].toSorted((left, right) => right.addedAt - left.addedAt)
    const seen = new Set<string>()
    return sorted.filter((entry) => {
      const normalizedUid = entry.uid.toLowerCase()
      if (seen.has(normalizedUid)) {
        return false
      }
      seen.add(normalizedUid)
      return true
    })
  } catch {
    return []
  }
}

export const rememberPass = (
  pass: Pick<PassMemoryEntry, 'uid' | 'holder'>,
  storage?: PassMemoryStorage,
  addedAt = Date.now(),
): PassMemoryEntry[] => {
  try {
    const entry: PassMemoryEntry = { addedAt, holder: pass.holder, uid: pass.uid }
    const remembered = [
      entry,
      ...readPassMemory(storage).filter((stored) => stored.uid.toLowerCase() !== pass.uid.toLowerCase()),
    ].slice(0, 200)
    const target = storage ?? globalThis.localStorage
    target.setItem(PASS_MEMORY_KEY, JSON.stringify(remembered))
    return remembered
  } catch {
    return []
  }
}
