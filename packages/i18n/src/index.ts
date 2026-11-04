export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ja'
export type Copy<T> = Record<Locale, T>

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this predicate validates persisted browser input
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ja'

// The language an Accept-Language header asks for most: the highest-quality
// `ja` or `en` range, the earlier one on a tie. Other ranges and `q=0` ignored.
const preferredLocale = (acceptLanguage: string): Locale | null => {
  let best: { locale: Locale; quality: number } | null = null
  for (const range of acceptLanguage.split(',')) {
    const [tag = '', ...params] = range.split(';').map((part) => part.trim().toLowerCase())
    const primary = tag.split('-')[0]
    if (primary !== 'en' && primary !== 'ja') {
      continue
    }
    const q = params.find((param) => param.startsWith('q='))
    const quality = q === undefined ? 1 : Number(q.slice(2))
    if (Number.isFinite(quality) && quality > 0 && (best === null || quality > best.quality)) {
      best = { locale: primary, quality }
    }
  }
  return best?.locale ?? null
}

// First visit order: a saved choice, then the browser's own ranking of Japanese
// and English, then Japanese. The one place that decides it, for every app.
export const resolveLocale = (stored: string | null, acceptLanguage: string | null = null): Locale => {
  if (isLocale(stored)) {
    return stored
  }
  return (acceptLanguage === null ? null : preferredLocale(acceptLanguage)) ?? DEFAULT_LOCALE
}

export const pick = <T>(copy: Copy<T>, locale: Locale): T => copy[locale] ?? copy[DEFAULT_LOCALE]

export const AUTH_COPY = {
  en: { signInWithPasskey: 'Sign in with Passkey', signingIn: 'Signing in…' },
  ja: { signInWithPasskey: 'パスキーでサインイン', signingIn: 'サインイン中…' },
} satisfies Copy<{ signInWithPasskey: string; signingIn: string }>
