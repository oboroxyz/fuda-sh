import { isLocale, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { applyThemeMode, LanguageSwitcher, ThemeToggle, watchThemeMode } from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import { useRouter, useShared } from '@void/solid'
import { createEffect, createSignal, onCleanup } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'
import { isServer } from 'solid-js/web'

import { LOCALE_COOKIE, THEME_COOKIE } from './cookie-names.ts'
import { MEMBER_COPY } from './member/copy.ts'
import type { AppShared } from './server/session.ts'
import { endSession } from './session-client.ts'

// What every page reads from the Worker's middleware (src/server/session.ts).
export const useApp = (): AppShared => useShared()

export const useNavigate = (): ((path: string) => void) => {
  const router = useRouter()
  return (path) => {
    void router.visit(path)
  }
}

// A year: preferences outlive sessions.
const PREFERENCE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

const writePreference = (name: string, value: string): void => {
  // oxlint-disable-next-line unicorn/no-document-cookie -- a preference cookie the server reads for the first render; there is no Cookie Store API in every supported browser
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_MAX_AGE_SECONDS}; SameSite=Lax`
}

export interface Preferences {
  locale: Accessor<Locale>
  setLocale: (locale: Locale) => void
  setTheme: (theme: ThemeMode) => void
  theme: Accessor<ThemeMode>
}

// Language and theme, saved in cookies the server reads for its first render.
// A language change re-renders from the server, which owns the copy, keeping
// the page's state; a theme change applies at once.
export const usePreferences = (): Preferences => {
  const shared = useApp()
  const router = useRouter()
  const [theme, setThemeSignal] = createSignal<ThemeMode>(shared.theme)
  createEffect(() => {
    if (!isServer) {
      document.documentElement.lang = shared.locale
    }
  })
  createEffect(() => {
    if (!isServer) {
      onCleanup(watchThemeMode(theme()))
    }
  })
  return {
    locale: () => shared.locale,
    setLocale: (locale) => {
      writePreference(LOCALE_COOKIE, locale)
      void router.refresh({ preserveScroll: true, preserveState: true })
    },
    setTheme: (mode) => {
      writePreference(THEME_COOKIE, mode)
      applyThemeMode(mode)
      setThemeSignal(mode)
    },
    theme,
  }
}

export const useSignOut = (): (() => void) => {
  const router = useRouter()
  return () => {
    const run = async (): Promise<void> => {
      await endSession()
      await router.visit('/')
    }
    void run()
  }
}

// The language and theme controls on the member top.
export const Appearance = (): JSX.Element => {
  const preferences = usePreferences()
  const copy = () => pick(MEMBER_COPY, preferences.locale())
  return (
    <div class="app-appearance" role="group" aria-label={copy().settings.appearance}>
      <LanguageSwitcher
        class="h-9 w-9"
        current={preferences.locale()}
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
        mode={preferences.theme()}
        onChange={(mode) => {
          preferences.setTheme(mode)
        }}
      />
    </div>
  )
}
