import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, LOCALES, pick, resolveLocale } from './index.ts'

describe('locale contract', () => {
  it('supports English and Japanese with English as the fallback', () => {
    expect(LOCALES).toStrictEqual(['en', 'ja'])
    expect(DEFAULT_LOCALE).toBe('en')
    expect(resolveLocale('ja')).toBe('ja')
    expect(resolveLocale('fr')).toBe('en')
    expect(resolveLocale(null)).toBe('en')
  })

  it('selects the complete dictionary branch', () => {
    expect(pick({ en: { title: 'Rights' }, ja: { title: '権利' } }, 'ja')).toStrictEqual({ title: '権利' })
  })
})
