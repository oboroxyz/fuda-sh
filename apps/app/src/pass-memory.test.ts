import { describe, expect, it } from 'vitest'

import { PASS_MEMORY_KEY, readPassMemory, rememberPass } from './pass-memory.ts'
import type { PassMemoryStorage } from './pass-memory.ts'
import type { Hex } from '@fuda/sdk'

const uid: Hex = `0x${'11'.repeat(32)}`
const holder: Hex = `0x${'22'.repeat(20)}`
const newerUid: Hex = `0x${'33'.repeat(32)}`
const newerHolder: Hex = `0x${'44'.repeat(20)}`
const mixedCaseUid: Hex = `0x${'Aa'.repeat(32)}`

const storageWith = (value: string | null): PassMemoryStorage => ({
  getItem: (key) => (key === PASS_MEMORY_KEY ? value : null),
  setItem: () => {},
})

describe(readPassMemory, () => {
  it('reads valid entries newest-first', () => {
    const stored = [
      { addedAt: 100, holder, uid },
      { addedAt: 200, holder: newerHolder, uid: newerUid },
    ]

    expect(readPassMemory(storageWith(JSON.stringify(stored)))).toStrictEqual([
      { addedAt: 200, holder: newerHolder, uid: newerUid },
      { addedAt: 100, holder, uid },
    ])
  })

  it('returns an empty list for malformed JSON', () => {
    expect(readPassMemory(storageWith('{not-json'))).toStrictEqual([])
  })

  it('returns an empty list when any stored entry is malformed', () => {
    const stored = [
      { addedAt: 100, holder, uid },
      { addedAt: 200, holder: newerHolder, uid: '0xnot-a-uid' },
    ]

    expect(readPassMemory(storageWith(JSON.stringify(stored)))).toStrictEqual([])
  })

  it('rejects stored UIDs that are not canonical lowercase hex', () => {
    const stored = [{ addedAt: 100, holder, uid: mixedCaseUid }]

    expect(readPassMemory(storageWith(JSON.stringify(stored)))).toStrictEqual([])
  })

  it('collapses preexisting duplicate UIDs to the newest record', () => {
    const older = { addedAt: 100, holder, uid }
    const newest = { addedAt: 200, holder: newerHolder, uid }

    expect(readPassMemory(storageWith(JSON.stringify([older, newest])))).toStrictEqual([newest])
  })

  it('returns an empty list when accessing default localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })

    try {
      expect(readPassMemory()).toStrictEqual([])
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original)
      }
    }
  })
})

describe(rememberPass, () => {
  it('prepends a pass and writes the resulting list', () => {
    const stored = [{ addedAt: 100, holder, uid }]
    let written = JSON.stringify(stored)
    const storage: PassMemoryStorage = {
      getItem: () => written,
      setItem: (_key, value) => {
        written = value
      },
    }
    const expected = [
      { addedAt: 200, holder: newerHolder, uid: newerUid },
      { addedAt: 100, holder, uid },
    ]

    expect(rememberPass({ holder: newerHolder, uid: newerUid }, storage, 200)).toStrictEqual(expected)
    expect(JSON.parse(written)).toStrictEqual(expected)
  })

  it('replaces an older same-uid entry regardless of hex case', () => {
    const oldEntry = { addedAt: 100, holder, uid: mixedCaseUid.toLowerCase() as Hex }
    const expected = [{ addedAt: 200, holder: newerHolder, uid: mixedCaseUid }]
    const storage = storageWith(JSON.stringify([oldEntry]))
    let written = ''
    const writableStorage: PassMemoryStorage = {
      getItem: storage.getItem,
      setItem: (_key, value) => {
        written = value
      },
    }

    expect(rememberPass({ holder: newerHolder, uid: mixedCaseUid }, writableStorage, 200)).toStrictEqual(expected)
    expect(JSON.parse(written)).toStrictEqual(expected)
  })

  it('caps remembered passes at 200 records', () => {
    const existing = Array.from({ length: 200 }, (_, index) => ({
      addedAt: index,
      holder: `0x${(index + 1).toString(16).padStart(2, '0').repeat(20)}`,
      uid: `0x${(index + 1).toString(16).padStart(2, '0').repeat(32)}`,
    }))
    const storage = storageWith(JSON.stringify(existing))

    let written = ''
    const writableStorage: PassMemoryStorage = {
      getItem: storage.getItem,
      setItem: (_key, value) => {
        written = value
      },
    }

    const result = rememberPass({ holder: newerHolder, uid: newerUid }, writableStorage, 200)
    expect(result).toHaveLength(200)
    expect(result[0]).toStrictEqual({ addedAt: 200, holder: newerHolder, uid: newerUid })
    expect(JSON.parse(written)).toHaveLength(200)
  })

  it('returns an empty list when writing is blocked', () => {
    const storage: PassMemoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    }

    expect(rememberPass({ holder, uid }, storage, 100)).toStrictEqual([])
  })
})
