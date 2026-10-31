import { isLocale, pick } from '@fuda/i18n'
import { applyThemeMode, LanguageSwitcher, ThemeToggle, watchThemeMode } from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import { useRouter, useShared } from '@void/solid'
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'
import { isServer } from 'solid-js/web'

import { LOCALE_COOKIE, THEME_COOKIE } from './cookie-names.ts'
import { DASH_COPY } from './copy.ts'
import type { DashCopy } from './copy.ts'
import { routeFromPath } from './router.ts'
import type { DashRoute } from './router.ts'
import type { DashShared } from './server/session.ts'
import { endSession } from './session-client.ts'

// What every dashboard page reads from the Worker's middleware
// (src/server/session.ts): the session's surface, the operator's venue and the
// presentation preferences.
export const useDash = (): DashShared => useShared()

export const useCopy = (): Accessor<DashCopy> => {
  const shared = useDash()
  return createMemo(() => pick(DASH_COPY, shared.locale))
}

// The current route, from the URL Void's router reports.
export const useRoute = (): Accessor<DashRoute> => {
  const router = useRouter()
  return createMemo(() => routeFromPath(router.path))
}

export const useNavigate = (): ((route: string) => void) => {
  const router = useRouter()
  return (route) => {
    void router.visit(route)
  }
}

// An api 401 has already ended the session in the Worker (src/server/forward.ts);
// sign-in says why.
export const useSessionExpired = (): (() => void) => {
  const router = useRouter()
  return () => {
    void router.visit('/signin?reason=unauthorized')
  }
}

export const useSignOut = (): (() => void) => {
  const router = useRouter()
  return () => {
    const run = async (): Promise<void> => {
      await endSession()
      await router.visit('/signin')
    }
    void run()
  }
}

// A year: preferences outlive sessions.
const PREFERENCE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

const writePreference = (name: string, value: string): void => {
  // oxlint-disable-next-line unicorn/no-document-cookie -- a preference cookie the server reads for the first render; there is no Cookie Store API in every supported browser
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_MAX_AGE_SECONDS}; SameSite=Lax`
}

// The language and theme controls. A language change re-renders from the
// server, which owns the copy; a theme change applies at once.
export const Appearance = (): JSX.Element => {
  const shared = useDash()
  const copy = useCopy()
  const router = useRouter()
  const [theme, setTheme] = createSignal<ThemeMode>(shared.theme)
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
  return (
    <div class="dash-appearance">
      <LanguageSwitcher
        class="h-9 w-9"
        current={shared.locale}
        label={copy().chrome.language}
        options={[
          { label: copy().chrome.english, value: 'en' },
          { label: copy().chrome.japanese, value: 'ja' },
        ]}
        onChange={(value) => {
          if (isLocale(value)) {
            writePreference(LOCALE_COOKIE, value)
            void router.refresh({ preserveScroll: true, preserveState: true })
          }
        }}
      />
      <ThemeToggle
        class="h-9 w-9"
        labels={copy().chrome.theme}
        mode={theme()}
        onChange={(mode) => {
          writePreference(THEME_COOKIE, mode)
          applyThemeMode(mode)
          setTheme(mode)
        }}
      />
    </div>
  )
}

// Wraps a browser api call so a 401 (the Worker has already ended the session)
// sends the operator to sign-in, wherever the call came from.
export const useGuarded = (): (<A extends unknown[], R extends { ok: boolean; status?: number }>(
  call: (...args: A) => Promise<R>,
) => (...args: A) => Promise<R>) => {
  const expired = useSessionExpired()
  return (call) =>
    async (...args) => {
      const result = await call(...args)
      if (!result.ok && result.status === 401) {
        expired()
      }
      return result
    }
}

// The operator's venue and cards, which the middleware reads on every request.
export const useOperator = () => {
  const shared = useDash()
  return {
    cards: () => shared.operator?.cards ?? [],
    issuer: () => shared.operator?.issuer ?? null,
    operator: () => shared.operator,
    publicUrl: () => shared.operator?.publicUrl ?? null,
  }
}

// Re-reads the page's props and the session's shared data in place: the page
// component and its form state stay, only the server's data changes.
export const useRefresh = (): (() => Promise<void>) => {
  const router = useRouter()
  return async () => {
    await router.refresh({ preserveScroll: true, preserveState: true })
  }
}
