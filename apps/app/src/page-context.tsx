import { isLocale, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { LanguageSwitcher, ThemeToggle } from '@fuda/ui'
import { useStable } from '@fuda/ui/hooks'
import { useAppearance } from '@fuda/ui/preferences'
import type { ThemeMode } from '@fuda/ui/theme'
import type { JSX } from 'preact'
import { useRouter, useShared } from 'void-preact'

import { LOCALE_COOKIE, THEME_COOKIE } from './cookie-names.ts'
import { MEMBER_COPY } from './member/copy.ts'
import type { AppShared } from './server/session.ts'
import { endSession } from './session-client.ts'

// What every page reads from the Worker's middleware (src/server/session.ts).
export const useApp = (): AppShared => useShared()

export const useNavigate = (): ((path: string) => void) => {
  const router = useRouter()
  return useStable((path: string) => {
    void router.visit(path)
  })
}

export interface Preferences {
  locale: Locale
  setLocale: (locale: Locale) => void
  setTheme: (theme: ThemeMode) => void
  theme: ThemeMode
}

export const usePreferences = (): Preferences => {
  const shared = useApp()
  const router = useRouter()
  return useAppearance({
    locale: shared.locale,
    localeCookie: LOCALE_COOKIE,
    refresh: () => {
      void router.refresh({ preserveScroll: true, preserveState: true })
    },
    theme: shared.theme,
    themeCookie: THEME_COOKIE,
  })
}

export const useSignOut = (): (() => void) => () => {
  void (async () => {
    await endSession()
    window.location.assign('/')
  })()
}

// The language and theme controls on the member top.
export const Appearance = (): JSX.Element => {
  const preferences = usePreferences()
  const copy = () => pick(MEMBER_COPY, preferences.locale)
  return (
    <div class="app-appearance" role="group" aria-label={copy().settings.appearance}>
      <LanguageSwitcher
        class="h-9 w-9"
        current={preferences.locale}
        label={copy().chrome.language}
        options={[
          { label: 'English', value: 'en' },
          { label: '日本語', value: 'ja' },
        ]}
        onChange={(value) => {
          if (isLocale(value)) {
            preferences.setLocale(value)
          }
        }}
      />
      <ThemeToggle
        class="h-9 w-9"
        labels={copy().chrome.theme}
        mode={preferences.theme}
        onChange={(mode) => {
          preferences.setTheme(mode)
        }}
      />
    </div>
  )
}
