import type { Hex } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { CARD_MEMORY_KEY, cardKey, readCard, readCardMemory, rememberCard } from './card-memory.ts'
import type { PassMemoryStorage } from './pass-memory.ts'

const uid: Hex = `0x${'11'.repeat(32)}`
const holder: Hex = `0x${'22'.repeat(20)}`
const otherUid: Hex = `0x${'33'.repeat(32)}`
// A member number carries a check character; this pair is drawn from the sdk's
// own alphabet with a valid check.
const MEMBER_NUMBER = 'qj2yxphepdrka'
const HANDLE = 'wassie-coffee'
const SLUG = 'regular'
const OTHER_SLUG = 'gig'
const KEY = cardKey(HANDLE, SLUG)
const OTHER_KEY = cardKey(HANDLE, OTHER_SLUG)

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

describe(cardKey, () => {
  it('joins the venue and the card into one flat key', () => {
    expect(cardKey(HANDLE, SLUG)).toBe('wassie-coffee/regular')
  })
})

describe(readCardMemory, () => {
  it('reads a valid per-card record', () => {
    const stored = { [KEY]: { holder, issuedAt: 100, memberNumber: MEMBER_NUMBER, uid } }

    expect(readCardMemory(storageWith(JSON.stringify(stored)))).toStrictEqual(stored)
    expect(readCard(HANDLE, SLUG, storageWith(JSON.stringify(stored)))).toStrictEqual(stored[KEY])
    expect(readCard(HANDLE, OTHER_SLUG, storageWith(JSON.stringify(stored)))).toBeNull()
    expect(readCard('other', SLUG, storageWith(JSON.stringify(stored)))).toBeNull()
  })

  // A member may hold several cards from one venue, so two cards of the same
  // handle must sit side by side rather than replace one another.
  it('keeps two cards of the same venue side by side', () => {
    const stored = {
      [KEY]: { holder, issuedAt: 100, memberNumber: MEMBER_NUMBER, uid },
      [OTHER_KEY]: { holder, issuedAt: 200, memberNumber: MEMBER_NUMBER, uid: otherUid },
    }
    const storage = storageWith(JSON.stringify(stored))

    expect(readCardMemory(storage)).toStrictEqual(stored)
    expect(readCard(HANDLE, SLUG, storage)?.uid).toBe(uid)
    expect(readCard(HANDLE, OTHER_SLUG, storage)?.uid).toBe(otherUid)
  })

  it('returns an empty record for malformed JSON, a list, or nothing stored', () => {
    expect(readCardMemory(storageWith('{not-json'))).toStrictEqual({})
    expect(readCardMemory(storageWith('[]'))).toStrictEqual({})
    expect(readCardMemory(storageWith(null))).toStrictEqual({})
  })

  it('rejects the whole record when any entry or key is malformed', () => {
    const good = { holder, issuedAt: 100, memberNumber: MEMBER_NUMBER, uid }
    const badUid = { [KEY]: good, [OTHER_KEY]: { ...good, uid: '0xnot-a-uid' } }
    const badNumber = { [KEY]: { ...good, memberNumber: 'free text' } }
    const extraKey = { [KEY]: { ...good, extra: true } }
    const badHandle = { [cardKey('Wassie Coffee', SLUG)]: good }

    expect(readCardMemory(storageWith(JSON.stringify(badUid)))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify(badNumber)))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify(extraKey)))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify(badHandle)))).toStrictEqual({})
  })

  // A key must name both a venue and a card: a bare handle, a reserved slug or
  // a third segment is not an address this app can read back.
  it('rejects a key that is not a venue and card pair', () => {
    const good = { holder, issuedAt: 100, memberNumber: MEMBER_NUMBER, uid }

    expect(readCardMemory(storageWith(JSON.stringify({ [HANDLE]: good })))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify({ [`${HANDLE}/cards`]: good })))).toStrictEqual({})
    expect(readCardMemory(storageWith(JSON.stringify({ [`${KEY}/extra`]: good })))).toStrictEqual({})
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
  it('writes the card under its venue and slug, keeping the venue’s other cards', () => {
    const existing = { [OTHER_KEY]: { holder, issuedAt: 50, memberNumber: MEMBER_NUMBER, uid: otherUid } }
    const storage = writable(JSON.stringify(existing))
    const expected = { ...existing, [KEY]: { holder, issuedAt: 200, memberNumber: MEMBER_NUMBER, uid } }

    expect(
      rememberCard(HANDLE, SLUG, { holder, memberNumber: MEMBER_NUMBER, uid }, storage, 200),
    ).toStrictEqual(expected)
    expect(JSON.parse(storage.written() ?? '')).toStrictEqual(expected)
  })

  it('replaces an earlier card for the same slug and lowercases the uid', () => {
    const storage = writable(
      JSON.stringify({ [KEY]: { holder, issuedAt: 50, memberNumber: MEMBER_NUMBER, uid: otherUid } }),
    )
    const mixed: Hex = `0x${'Aa'.repeat(32)}`

    expect(
      rememberCard(HANDLE, SLUG, { holder, memberNumber: MEMBER_NUMBER, uid: mixed }, storage, 200),
    ).toStrictEqual({
      [KEY]: { holder, issuedAt: 200, memberNumber: MEMBER_NUMBER, uid: mixed.toLowerCase() },
    })
  })

  it('rejects invalid input without overwriting existing memory', () => {
    const stored = JSON.stringify({ [KEY]: { holder, issuedAt: 50, memberNumber: MEMBER_NUMBER, uid } })
    const storage = writable(stored)

    expect(
      rememberCard(HANDLE, SLUG, { holder, memberNumber: MEMBER_NUMBER, uid: 'nope' as Hex }, storage),
    ).toBeNull()
    expect(rememberCard('Bad Handle', SLUG, { holder, memberNumber: MEMBER_NUMBER, uid }, storage)).toBeNull()
    expect(rememberCard(HANDLE, 'cards', { holder, memberNumber: MEMBER_NUMBER, uid }, storage)).toBeNull()
    expect(rememberCard(HANDLE, SLUG, { holder, memberNumber: 'free text', uid }, storage)).toBeNull()
    expect(storage.written()).toBe(stored)
  })

  it('returns null when writing is blocked', () => {
    const storage: PassMemoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    }

    expect(rememberCard(HANDLE, SLUG, { holder, memberNumber: MEMBER_NUMBER, uid }, storage, 100)).toBeNull()
  })
})
