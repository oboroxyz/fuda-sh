import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, resolveLocale } from './index.ts'
import type { Locale } from './index.ts'

export interface LocaleEnvironment {
  readStored: () => string | null
  writeStored: (locale: Locale) => void
  setDocumentLanguage: (locale: Locale) => void
}

const browserLocaleEnvironment: LocaleEnvironment = {
  readStored: () => window.localStorage.getItem(LOCALE_STORAGE_KEY),
  writeStored: (locale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  },
  setDocumentLanguage: (locale) => {
    document.documentElement.lang = locale
  },
}

export const getLocale = (environment: LocaleEnvironment = browserLocaleEnvironment): Locale => {
  try {
    return resolveLocale(environment.readStored())
  } catch {
    return DEFAULT_LOCALE
  }
}

export const setLocale = (
  locale: Locale,
  environment: LocaleEnvironment = browserLocaleEnvironment,
): void => {
  try {
    environment.writeStored(locale)
  } catch {
    // The active page still changes language when persistence is unavailable.
  }
  environment.setDocumentLanguage(locale)
}
