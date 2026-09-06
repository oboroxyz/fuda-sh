import { asHex, isUid } from '@fuda/sdk'
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

  // SAFETY: the object/array checks above establish that this is a decoded record candidate.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-unsafe-dictionary-type -- indexed access is required to validate untrusted JSON fields
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return (
    keys.length === 3 &&
    keys.includes('uid') &&
    keys.includes('holder') &&
    keys.includes('addedAt') &&
    typeof record.uid === 'string' &&
    isUid(record.uid) &&
    typeof record.holder === 'string' &&
    asHex(record.holder, 20) !== null &&
    typeof record.addedAt === 'number' &&
    Number.isFinite(record.addedAt) &&
    record.addedAt >= 0
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

    return [...decoded].toSorted((left, right) => right.addedAt - left.addedAt)
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
