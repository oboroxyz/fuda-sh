import { applyThemeMode, watchThemeMode } from '@fuda/ui/theme'
import type { ThemeMode } from '@fuda/ui/theme'
import { useEffect, useState } from 'preact/hooks'

const PREFERENCE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60
const writePreference = (name: string, value: string): void => {
  // oxlint-disable-next-line unicorn/no-document-cookie -- the Worker needs the preference for the first paint, including browsers without Cookie Store
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_MAX_AGE_SECONDS}; SameSite=Lax`
}

export const useAppearance = <L extends string>(options: {
  locale: L
  localeCookie: string
  refresh: () => void
  theme: ThemeMode
  themeCookie: string
}) => {
  const [theme, setTheme] = useState(options.theme)
  useEffect(() => {
    document.documentElement.lang = options.locale
  }, [options.locale])
  useEffect(() => watchThemeMode(theme), [theme])
  return {
    locale: options.locale,
    setLocale: (locale: L) => {
      writePreference(options.localeCookie, locale)
      options.refresh()
    },
    setTheme: (mode: ThemeMode) => {
      writePreference(options.themeCookie, mode)
      applyThemeMode(mode)
      setTheme(mode)
    },
    theme,
  }
}
