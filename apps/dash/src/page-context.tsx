import { isLocale, pick } from '@fuda/i18n'
import { LanguageSwitcher, ThemeToggle } from '@fuda/ui-preact'
import { useStable } from '@fuda/ui-preact/hooks'
import { useAppearance } from '@fuda/ui-preact/preferences'
import type { JSX } from 'preact'
import { useCallback, useRef } from 'preact/hooks'
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

// The language and theme controls. A language change re-renders from the
// server, which owns the copy; a theme change applies at once.
export const Appearance = (): JSX.Element => {
  const shared = useDash()
  const copy = useCopy()
  const router = useRouter()
  const preferences = useAppearance({
    locale: shared.locale,
    localeCookie: LOCALE_COOKIE,
    refresh: () => {
      void router.refresh({ preserveScroll: true, preserveState: true })
    },
    theme: shared.theme,
    themeCookie: THEME_COOKIE,
  })
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
            preferences.setLocale(value)
          }
        }}
      />
      <ThemeToggle
        class="h-9 w-9"
        labels={copy.chrome.theme}
        mode={preferences.theme}
        onChange={(mode) => {
          preferences.setTheme(mode)
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
