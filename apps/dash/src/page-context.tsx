import { isLocale, pick } from '@fuda/i18n'
import { LanguageSwitcher, ThemeToggle } from '@fuda/ui-preact'
import { applyThemeMode, watchThemeMode } from '@fuda/ui/theme'
import type { ThemeMode } from '@fuda/ui/theme'
import type { JSX } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useRouter, useShared } from 'void-preact'

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

// A callback whose identity never changes and which always calls the latest
// closure: pages hand these to components that compare or depend on them, so a
// rerender must not look like a new endpoint.
const useStable = <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) => {
  const latest = useRef(fn)
  latest.current = fn
  return useCallback((...args: A) => latest.current(...args), [])
}

export const useCopy = (): DashCopy => pick(DASH_COPY, useDash().locale)

// The current route, from the URL Void's router reports.
export const useRoute = (): DashRoute => routeFromPath(useRouter().path)

export const useNavigate = (): ((route: string) => void) => {
  const router = useRouter()
  return useStable((route: string) => {
    void router.visit(route)
  })
}

// An api 401 has already ended the session in the Worker (src/server/forward.ts);
// sign-in says why.
export const useSessionExpired = (): (() => void) => {
  const router = useRouter()
  return useStable(() => {
    void router.visit('/signin?reason=unauthorized')
  })
}

const signOutAndLeave = async (): Promise<void> => {
  await endSession()
  window.location.assign('/signin')
}
const signOut = (): void => {
  void signOutAndLeave()
}
export const useSignOut = (): (() => void) => signOut

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
  const [theme, setTheme] = useState<ThemeMode>(shared.theme)
  useEffect(() => {
    document.documentElement.lang = shared.locale
  }, [shared.locale])
  useEffect(() => watchThemeMode(theme), [theme])
  return (
    <div class="dash-appearance">
      <LanguageSwitcher
        class="h-9 w-9"
        current={shared.locale}
        label={copy.chrome.language}
        options={[
          { label: copy.chrome.english, value: 'en' },
          { label: copy.chrome.japanese, value: 'ja' },
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
        labels={copy.chrome.theme}
        mode={theme}
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
// sends the operator to sign-in, wherever the call came from. Wrapping the same
// call twice returns the same function, so props built from it stay equal.
export const useGuarded = (): (<A extends unknown[], R extends { ok: boolean; status?: number }>(
  call: (...args: A) => Promise<R>,
) => (...args: A) => Promise<R>) => {
  const expired = useSessionExpired()
  const wrapped = useRef(new WeakMap<object, object>())
  return useCallback(
    <A extends unknown[], R extends { ok: boolean; status?: number }>(
      call: (...args: A) => Promise<R>,
    ): ((...args: A) => Promise<R>) => {
      const known = wrapped.current.get(call)
      if (known !== undefined) {
        // SAFETY: the cache is keyed by `call` and only ever stores its own wrapper.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a WeakMap cannot carry the per-key function type
        return known as (...args: A) => Promise<R>
      }
      const guard = async (...args: A): Promise<R> => {
        const result = await call(...args)
        if (!result.ok && result.status === 401) {
          expired()
        }
        return result
      }
      wrapped.current.set(call, guard)
      return guard
    },
    [expired],
  )
}

// The operator's venue and cards, which the middleware reads on every request.
export const useOperator = () => {
  const shared = useDash()
  return {
    cards: shared.operator?.cards ?? [],
    issuer: shared.operator?.issuer ?? null,
    operator: shared.operator,
    publicUrl: shared.operator?.publicUrl ?? null,
  }
}

// Re-reads the page's props and the session's shared data in place: the page
// component and its form state stay, only the server's data changes.
export const useRefresh = (): (() => Promise<void>) => {
  const router = useRouter()
  return useStable(async () => {
    await router.refresh({ preserveScroll: true, preserveState: true })
  })
}
