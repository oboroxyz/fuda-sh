export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_STORAGE_KEY = 'fuda:locale'
export type Copy<T> = Record<Locale, T>

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

export const resolveLocale = (stored: string | null): Locale => (isLocale(stored) ? stored : DEFAULT_LOCALE)

export const pick = <T>(copy: Copy<T>, locale: Locale): T => copy[locale] ?? copy[DEFAULT_LOCALE]
