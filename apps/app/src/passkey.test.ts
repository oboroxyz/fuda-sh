import { describe, expect, it } from 'vitest'

import { passkeyUserId, USER_ID_KEY } from './passkey.ts'
import type { IdStorage } from './passkey.ts'

// Just enough of the Storage surface `passkeyUserId` touches, plus a switch that
// makes every access throw the way a browser with site data blocked does.
const fakeStorage = (initial: string | null = null) => {
  let value = initial
  let blocked = false
  const storage: IdStorage = {
    getItem: (key) => {
      if (blocked) {
        throw new Error('storage blocked')
      }
      return key === USER_ID_KEY ? value : null
    },
    setItem: (key, next) => {
      if (blocked) {
        throw new Error('storage blocked')
      }
      if (key === USER_ID_KEY) {
        value = next
      }
    },
  }
  return {
    block: () => {
      blocked = true
    },
    read: () => value,
    storage,
  }
}

describe(passkeyUserId, () => {
  it('generates one 16-byte id and returns the same one on every later call', () => {
    const store = fakeStorage()
    const first = passkeyUserId(store.storage)
    const second = passkeyUserId(store.storage)
    expect(first).toHaveLength(16)
    expect([...second]).toStrictEqual([...first])
    expect(store.read()).toMatch(/^[0-9a-f]{32}$/u)
  })

  it('mints a fresh id when the store is empty or holds a malformed value', () => {
    const empty = passkeyUserId(fakeStorage().storage)
    const malformed = fakeStorage('not-hex')
    const replaced = passkeyUserId(malformed.storage)
    expect(empty).toHaveLength(16)
    expect(replaced).toHaveLength(16)
    expect(malformed.read()).toMatch(/^[0-9a-f]{32}$/u)
  })

  it('still returns an id when storage is blocked outright', () => {
    const store = fakeStorage()
    store.block()
    expect(passkeyUserId(store.storage)).toHaveLength(16)
  })
})
