export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ja'
export type Copy<T> = Record<Locale, T>

// Narrows persisted browser input, a request header part or a form value.
export const isLocale = (value: string | null | undefined): value is Locale =>
  value === 'en' || value === 'ja'

interface Ranked {
  locale: Locale
  quality: number
}

// One Accept-Language range as a ja or en candidate; null for any other
// language, for `q=0` (refused) and for a quality that is not a number.
const rankedRange = (range: string): Ranked | null => {
  const [tag = '', ...params] = range.split(';').map((part) => part.trim().toLowerCase())
  const [locale] = tag.split('-')
  if (!isLocale(locale)) {
    return null
  }
  const q = params.find((param) => param.startsWith('q='))
  const quality = q === undefined ? 1 : Number(q.slice(2))
  return Number.isFinite(quality) && quality > 0 ? { locale, quality } : null
}

// The language an Accept-Language header asks for most: the highest-quality
// `ja` or `en` range, the earlier one on a tie.
const preferredLocale = (acceptLanguage: string): Locale | null => {
  let best: Ranked | null = null
  for (const range of acceptLanguage.split(',')) {
    const ranked = rankedRange(range)
    if (ranked !== null && (best === null || ranked.quality > best.quality)) {
      best = ranked
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

export const PAGE_COPY = {
  en: {
    appTitle: 'app - fuda.sh',
    dashTitle: 'dashboard - fuda.sh',
    description:
      'Issue membership, loyalty, and ticket cards in minutes. Add them to Apple & Google Wallet. No app, no lock-in, verifiable by anyone.',
    ogLocale: 'en_US',
  },
  ja: {
    appTitle: 'パス - fuda.sh',
    dashTitle: 'お店の管理 - fuda.sh',
    description:
      '会員証、スタンプカード、チケットを作って、Apple WalletやGoogle Walletに追加できます。専用アプリは不要です。',
    ogLocale: 'ja_JP',
  },
} satisfies Copy<{
  appTitle: string
  dashTitle: string
  description: string
  ogLocale: string
}>
