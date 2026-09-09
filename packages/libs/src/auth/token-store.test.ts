import { beforeEach, describe, expect, it } from 'vitest'

import { createTokenStore } from './index.ts'

describe(createTokenStore, () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('isolates audiences and API deployments and retains a replacement token', () => {
    const operator = createTokenStore({ apiBaseUrl: '/api', audience: 'operator' })
    const member = createTokenStore({ apiBaseUrl: '/api', audience: 'member' })
    const other = createTokenStore({ apiBaseUrl: '/other', audience: 'member' })
    operator.save('operator')
    member.save('first')
    other.save('other')
    member.save('replacement')
    member.clear('first')
    expect(member.read()).toBe('replacement')
    member.clear('replacement')
    expect(member.read()).toBeNull()
    expect(operator.read()).toBe('operator')
    expect(other.read()).toBe('other')
    expect(localStorage.getItem('fuda:dash:operator:/api')).toBe('operator')
  })

  it('allows in-memory sessions when storage is blocked', () => {
    const store = createTokenStore({
      apiBaseUrl: '/api',
      audience: 'member',
      storage: () => {
        throw new Error('blocked')
      },
    })
    expect(store.read()).toBeNull()
    expect(() => {
      store.save('token')
    }).not.toThrow()
    expect(() => {
      store.clear('token')
    }).not.toThrow()
  })
})
