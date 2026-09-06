export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_STORAGE_KEY = 'fuda:locale'
export type Copy<T> = Record<Locale, T>

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this predicate validates persisted browser input
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ja'

export const resolveLocale = (stored: string | null): Locale => (isLocale(stored) ? stored : DEFAULT_LOCALE)

export const pick = <T>(copy: Copy<T>, locale: Locale): T => copy[locale] ?? copy[DEFAULT_LOCALE]
