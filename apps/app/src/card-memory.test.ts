import type { Hex } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { CARD_MEMORY_KEY, readCard, readCardMemory, rememberCard } from './card-memory.ts'
import type { PassMemoryStorage } from './pass-memory.ts'

const uid: Hex = `0x${'11'.repeat(32)}`
const holder: Hex = `0x${'22'.repeat(20)}`
const otherUid: Hex = `0x${'33'.repeat(32)}`
// A member number carries a check character; this pair is drawn from the sdk's
// own alphabet with a valid check.
const MEMBER_NUMBER = 'qj2yxphepdrka'
const HANDLE = 'wassie-coffee'

const storageWith = (value: string | null): PassMemoryStorage => ({
  getItem: (key) => (key === CARD_MEMORY_KEY ? value : null),
  setItem: () => {},
})

const writable = (initial: string | null): PassMemoryStorage & { written: () => string | null } => {
  let written = initial
  return {
    getItem: () => written,
    setItem: (_key, value) => {
      written = value
    },
    written: () => written,
  }
}

describe(readCardMemory, () => {
  it('reads a valid per-handle record', () => {
    const stored = { [HANDLE]: { holder, issuedAt: 100, memberNumber: MEMBER_NUMBER, uid } }

    expect(readCardMemory(storageWith(JSON.stringify(stored)))).toStrictEqual(stored)
    expect(readCard(HANDLE, storageWith(JSON.stringify(stored)))).toStrictEqual(stored[HANDLE])
    expect(readCard('other', storageWith(JSON.stringify(stored)))).toBeNull()
  })

  it('returns an empty record for malformed JSON, a list, or nothing stored', () => {
    expect(readCardMemory(storageWith('{not-json'))).toStrictEqual({})
    expect(readCardMemory(storageWith('[]'))).toStrictEqual({})
    expect(readCardMemory(storageWith(null))).toStrictEqual({})
  })

  it('rejects the whole record when any entry or handle is malformed', () => {
    const good = { holder, issuedAt: 100, memberNumber: MEMBER_NUMBER, uid }
    const badUid = { [HANDLE]: good, other: { ...good, uid: '0xnot-a-uid' } }
    const badNumber = { [HANDLE]: { ...good, memberNumber: 'free text' } }
    const extraKey = { [HANDLE]: { ...good, extra: true } }
    const badHandle = { 'Wassie Coffee': good }

    expect(readCardMemory(storageWith(JSON.stringify(badUid)))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify(badNumber)))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify(extraKey)))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify(badHandle)))).toStrictEqual({})
  })

  it('returns an empty record when accessing default localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })

    try {
      expect(readCardMemory()).toStrictEqual({})
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original)
      }
    }
  })
})

describe(rememberCard, () => {
  it('writes the card under its handle and keeps other venues', () => {
    const existing = { other: { holder, issuedAt: 50, memberNumber: MEMBER_NUMBER, uid: otherUid } }
    const storage = writable(JSON.stringify(existing))
    const expected = { ...existing, [HANDLE]: { holder, issuedAt: 200, memberNumber: MEMBER_NUMBER, uid } }

    expect(rememberCard(HANDLE, { holder, memberNumber: MEMBER_NUMBER, uid }, storage, 200)).toStrictEqual(
      expected,
    )
    expect(JSON.parse(storage.written() ?? '')).toStrictEqual(expected)
  })

  it('replaces an earlier card for the same handle and lowercases the uid', () => {
    const storage = writable(
      JSON.stringify({ [HANDLE]: { holder, issuedAt: 50, memberNumber: MEMBER_NUMBER, uid: otherUid } }),
    )
    const mixed: Hex = `0x${'Aa'.repeat(32)}`

    expect(
      rememberCard(HANDLE, { holder, memberNumber: MEMBER_NUMBER, uid: mixed }, storage, 200),
    ).toStrictEqual({
      [HANDLE]: { holder, issuedAt: 200, memberNumber: MEMBER_NUMBER, uid: mixed.toLowerCase() },
    })
  })

  it('rejects invalid input without overwriting existing memory', () => {
    const stored = JSON.stringify({ [HANDLE]: { holder, issuedAt: 50, memberNumber: MEMBER_NUMBER, uid } })
    const storage = writable(stored)

    expect(
      rememberCard(HANDLE, { holder, memberNumber: MEMBER_NUMBER, uid: 'nope' as Hex }, storage),
    ).toBeNull()
    expect(rememberCard('Bad Handle', { holder, memberNumber: MEMBER_NUMBER, uid }, storage)).toBeNull()
    expect(rememberCard(HANDLE, { holder, memberNumber: 'free text', uid }, storage)).toBeNull()
    expect(storage.written()).toBe(stored)
  })

  it('returns null when writing is blocked', () => {
    const storage: PassMemoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    }

    expect(rememberCard(HANDLE, { holder, memberNumber: MEMBER_NUMBER, uid }, storage, 100)).toBeNull()
  })
})
