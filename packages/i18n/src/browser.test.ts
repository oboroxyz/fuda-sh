import { describe, expect, it, vi } from 'vitest'

import { getLocale, setLocale } from './browser.ts'
import type { LocaleEnvironment } from './browser.ts'

const environment = (stored: string | null): LocaleEnvironment => ({
  readStored: vi.fn(() => stored),
  setDocumentLanguage: vi.fn(),
  writeStored: vi.fn(),
})

describe('browser locale preference', () => {
  it('reads a valid choice and defaults invalid data to English', () => {
    expect(getLocale(environment('ja'))).toBe('ja')
    expect(getLocale(environment('broken'))).toBe('en')
  })

  it('falls back to English when storage reads throw', () => {
    const env = environment(null)
    env.readStored = () => {
      throw new Error('blocked')
    }
    expect(getLocale(env)).toBe('en')
  })

  it('persists the selected locale', () => {
    const env = environment(null)
    setLocale('ja', env)
    expect(env.writeStored).toHaveBeenCalledWith('ja')
  })

  it('updates document language even when persistence is blocked', () => {
    const env = environment(null)
    env.writeStored = () => {
      throw new Error('blocked')
    }
    setLocale('ja', env)
    expect(env.setDocumentLanguage).toHaveBeenCalledWith('ja')
  })
})
