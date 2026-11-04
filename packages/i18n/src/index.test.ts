import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, LOCALES, pick, resolveLocale } from './index.ts'

describe('locale contract', () => {
  it('supports English and Japanese with Japanese as the default', () => {
    expect(LOCALES).toStrictEqual(['en', 'ja'])
    expect(DEFAULT_LOCALE).toBe('ja')
  })

  it('lets a saved choice win over the browser', () => {
    expect(resolveLocale('en', 'ja-JP,ja;q=0.9')).toBe('en')
    expect(resolveLocale('ja', 'en-US,en;q=0.9')).toBe('ja')
  })

  it('ignores an unknown saved value and asks the browser', () => {
    expect(resolveLocale('fr', 'en-US')).toBe('en')
    expect(resolveLocale('', 'ja')).toBe('ja')
  })

  it('follows the highest-ranked of ja or en in Accept-Language', () => {
    expect(resolveLocale(null, 'en-US,en;q=0.9,ja;q=0.8')).toBe('en')
    expect(resolveLocale(null, 'ja-JP,ja;q=0.9,en;q=0.8')).toBe('ja')
    expect(resolveLocale(null, 'fr-FR,en;q=0.5,ja;q=0.7')).toBe('ja')
    expect(resolveLocale(null, 'en;q=0.3, JA;q=0.4')).toBe('ja')
  })

  it('breaks a tie by order and skips a range refused with q=0', () => {
    expect(resolveLocale(null, 'ja,en')).toBe('ja')
    expect(resolveLocale(null, 'en,ja')).toBe('en')
    expect(resolveLocale(null, 'ja;q=0, en;q=0.1')).toBe('en')
  })

  it('falls back to Japanese when the browser names neither', () => {
    expect(resolveLocale(null, null)).toBe('ja')
    expect(resolveLocale(null)).toBe('ja')
    expect(resolveLocale(null, '')).toBe('ja')
    expect(resolveLocale(null, 'fr-FR,de;q=0.8,*;q=0.1')).toBe('ja')
    expect(resolveLocale(null, 'ja;q=junk, en;q=0')).toBe('ja')
  })

  it('selects the complete dictionary branch', () => {
    expect(pick({ en: { title: 'Rights' }, ja: { title: '権利' } }, 'ja')).toStrictEqual({ title: '権利' })
  })
})
