/** @jsxImportSource hono/jsx/dom */
import { isLocale, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { getLocale, setLocale } from '@fuda/i18n/browser'
import { createSessionGeneration, createTokenStore } from '@fuda/libs/auth'
import { useQueryScope } from '@fuda/libs/query'
import { normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import {
  applyThemeMode,
  LanguageSwitcher,
  readThemeMode,
  saveThemeMode,
  ThemeToggle,
  watchThemeMode,
} from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { API_BASE_URL } from './config.ts'
import type { MemberPassListIo } from './member-pass-list.ts'
import { DEFAULT_MEMBER_IO, signInMember } from './member/auth.ts'
import type { MemberAppIo } from './member/auth.ts'
import { MEMBER_COPY } from './member/copy.ts'
import { Landing } from './member/Landing.tsx'
import { MemberLayout } from './member/MemberLayout.tsx'
import type { MemberRoute } from './member/MemberLayout.tsx'
import { PrivateScreen } from './member/PrivateScreen.tsx'
import { RightsList } from './member/RightsList.tsx'
import { Settings } from './member/Settings.tsx'
import { SignedGate } from './member/SignedGate.tsx'
import { SignIn } from './member/SignIn.tsx'
import { routeFor, safeMemberReturn } from './route.ts'
import type { Route } from './route.ts'
import { CardScreen } from './venue/CardScreen.tsx'

interface MemberSession {
  address: Hex
  token: string
}

type RestoreState = 'failed' | 'loading' | null
type SignInFailure = 'network' | 'rejected' | 'unavailable' | 'wallet'

const tokenStore = createTokenStore({ apiBaseUrl: API_BASE_URL, audience: 'member' })
const pathAndQuery = (): string => `${location.pathname}${location.search}`
const initialReturn = (): string =>
  location.pathname === '/signin'
    ? safeMemberReturn(new URLSearchParams(location.search).get('return'))
    : safeMemberReturn(pathAndQuery())

// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Route is an internal parsed union; this narrows its two object variants.
const isRedirectRoute = (route: Route): route is { redirect: string } =>
  typeof route === 'object' && 'redirect' in route
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Route is an internal parsed union; this narrows its two object variants.
const isCardRoute = (route: Route): route is { card: string; slug: string | null } =>
  typeof route === 'object' && 'card' in route

const MemberScreen = ({
  locale,
  address,
  onSignOut,
  onLocaleChange,
  onThemeChange,
  theme,
  passIo,
  queryClient,
  queryUid,
  route,
  onNavigate,
}: {
  locale: Locale
  address: Hex
  onSignOut: () => void
  onLocaleChange: (locale: Locale) => void
  onThemeChange: (theme: ThemeMode) => void
  theme: ThemeMode
  passIo?: MemberPassListIo
  queryClient: ReturnType<typeof useQueryScope>
  queryUid: Hex | null
  route: MemberRoute
  onNavigate: (path: string) => void
}): JSX.Element => {
  if (route === 'signed') {
    return <SignedGate locale={locale} />
  }
  if (route === 'private') {
    return <PrivateScreen locale={locale} />
  }
  if (route === 'settings') {
    return (
      <Settings
        locale={locale}
        theme={theme}
        onLocaleChange={onLocaleChange}
        onThemeChange={onThemeChange}
        onSignOut={onSignOut}
        passIo={passIo}
      />
    )
  }
  return (
    <RightsList
      locale={locale}
      initialAddress={address}
      io={passIo}
      onNavigate={onNavigate}
      queryClient={queryClient}
      queryUid={queryUid}
    />
  )
}

export interface AppProps {
  initialTheme?: ThemeMode
  memberIo?: MemberAppIo
  memberPassIo?: MemberPassListIo
}

interface LocationState {
  key: string
  route: Route
}

const readLocation = (): LocationState => {
  const key = pathAndQuery()
  return { key, route: routeFor(location.origin, key) }
}

const uidFromLocation = (key: string): Hex | null => {
  const queryAt = key.indexOf('?')
  if (queryAt === -1) {
    return null
  }
  const raw = new URLSearchParams(key.slice(queryAt)).get('uid')
  return raw === null ? null : normalizeUid(raw)
}

const MemberApp = ({
  locale,
  theme,
  onLocaleChange,
  onThemeChange,
  appearance,
  memberIo = DEFAULT_MEMBER_IO,
  memberPassIo,
}: Omit<AppProps, 'initialTheme'> & {
  locale: Locale
  theme: ThemeMode
  onLocaleChange: (locale: Locale) => void
  onThemeChange: (theme: ThemeMode) => void
  appearance: JSX.Element
}): JSX.Element => {
  const copy = pick(MEMBER_COPY, locale)
  const queryClient = useQueryScope()
  const [page, setPage] = useState<LocationState>(readLocation)
  const { key: locationKey, route } = page
  const [session, setSession] = useState<MemberSession | null>(null)
  const [savedToken] = useState(tokenStore.read)
  const [restore, setRestore] = useState<RestoreState>(savedToken === null ? null : 'loading')
  const [signingIn, setSigningIn] = useState(false)
  const [failure, setFailure] = useState<SignInFailure | null>(null)
  const [generation] = useState(createSessionGeneration)
  const activeToken = useRef<string | null>(savedToken)
  const requestedReturn = useRef(initialReturn())
  const signInPending = useRef(false)
  const signInAbort = useRef<AbortController | null>(null)
  const signInAttempt = useRef(0)

  const navigate = useCallback(
    (path: string): void => {
      if (signInAbort.current !== null) {
        signInAbort.current?.abort()
        signInAbort.current = null
        signInAttempt.current += 1
        generation.invalidate()
        signInPending.current = false
        setSigningIn(false)
      }
      history.pushState(null, '', path)
      setPage(readLocation())
    },
    [generation],
  )

  const clearLocal = useCallback((): void => {
    const token = activeToken.current
    generation.invalidate()
    activeToken.current = null
    tokenStore.clear(token)
    queryClient.clear()
    setSession(null)
    setRestore(null)
    setSigningIn(false)
    signInPending.current = false
    signInAbort.current?.abort()
    signInAbort.current = null
    signInAttempt.current += 1
    setFailure(null)
  }, [generation, queryClient])

  const signOut = useCallback((): void => {
    const token = activeToken.current
    clearLocal()
    history.pushState(null, '', '/')
    setPage(readLocation())
    if (token !== null) {
      void memberIo.logout(token)
    }
  }, [clearLocal, memberIo])

  const restoreSession = useCallback((): void => {
    const token = activeToken.current
    if (token === null) {
      return
    }
    generation.invalidate()
    const ticket = generation.capture()
    setRestore('loading')
    const run = async (): Promise<void> => {
      const result = await memberIo.me(token)
      if (!generation.isCurrent(ticket) || activeToken.current !== token) {
        return
      }
      if (result.ok) {
        if (tokenStore.read() !== token) {
          clearLocal()
          return
        }
        setSession({ address: result.body.address, token })
        setRestore(null)
        return
      }
      if (result.status === 401) {
        clearLocal()
      } else {
        setRestore('failed')
      }
    }
    void run()
  }, [clearLocal, generation, memberIo])

  useEffect(() => {
    const onPopState = (): void => {
      if (signInAbort.current !== null) {
        signInAbort.current?.abort()
        signInAbort.current = null
        signInAttempt.current += 1
        generation.invalidate()
        signInPending.current = false
        setSigningIn(false)
      }
      setPage(readLocation())
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      generation.invalidate()
      signInAbort.current?.abort()
      signInAttempt.current += 1
      queryClient.clear()
      window.removeEventListener('popstate', onPopState)
    }
  }, [generation, queryClient])
  useEffect(restoreSession, [restoreSession])
  useEffect(() => {
    if (session !== null && route === 'signin') {
      history.replaceState(null, '', requestedReturn.current)
      setPage(readLocation())
    }
  }, [route, session])

  if (isRedirectRoute(route)) {
    location.replace(route.redirect)
    return <div class="p-6">{copy.auth.redirecting}</div>
  }
  if (isCardRoute(route)) {
    return (
      <CardScreen
        key={`${route.card}/${route.slug ?? ''}`}
        handle={route.card}
        slug={route.slug}
        locale={locale}
      />
    )
  }
  if (route === 'top') {
    return (
      <div class="app-top">
        {appearance}
        <Landing locale={locale} signedIn={session !== null} onNavigate={navigate} />
      </div>
    )
  }

  const protectedRoute = route !== 'signin'
  if (session === null && protectedRoute) {
    requestedReturn.current = safeMemberReturn(pathAndQuery())
  }
  if (session === null && restore !== null) {
    return (
      <main class="member-auth-page">
        <section class="member-panel flex w-full flex-col gap-4" role="status">
          <h1 class="member-heading">{restore === 'loading' ? copy.auth.checking : copy.auth.failed}</h1>
          {restore === 'failed' ? (
            <p class="text-sm text-[var(--fuda-muted)]">{copy.auth.preserved}</p>
          ) : null}
          <div class="flex flex-col gap-2 sm:flex-row">
            {restore === 'failed' ? (
              <button class="btn btn-primary" type="button" onClick={restoreSession}>
                {copy.common.retry}
              </button>
            ) : null}
            <button class="btn btn-ghost" type="button" onClick={signOut}>
              {copy.auth.signOutLocal}
            </button>
          </div>
        </section>
      </main>
    )
  }
  if (session === null) {
    return (
      <SignIn
        locale={locale}
        busy={signingIn}
        failure={failure}
        onCancel={() => {
          signInAbort.current?.abort()
          signInAbort.current = null
          signInAttempt.current += 1
          generation.invalidate()
          signInPending.current = false
          setSigningIn(false)
        }}
        onNavigate={navigate}
        onSignIn={() => {
          if (signInPending.current) {
            return
          }
          signInPending.current = true
          const abort = new AbortController()
          signInAbort.current = abort
          signInAttempt.current += 1
          const attempt = signInAttempt.current
          generation.invalidate()
          const ticket = generation.capture()
          setSigningIn(true)
          setFailure(null)
          const run = async (): Promise<void> => {
            const outcome = await signInMember(memberIo, abort.signal)
            if (
              signInAttempt.current !== attempt ||
              !generation.isCurrent(ticket) ||
              pathAndQuery() !== locationKey
            ) {
              if (signInAttempt.current === attempt && signInAbort.current === abort) {
                signInPending.current = false
                signInAbort.current = null
                setSigningIn(false)
              }
              return
            }
            signInPending.current = false
            signInAbort.current = null
            setSigningIn(false)
            if (!outcome.ok) {
              setFailure(outcome.failure)
              return
            }
            const next = outcome.session
            activeToken.current = next.token
            tokenStore.save(next.token)
            setSession(next)
            const destination = requestedReturn.current
            history.replaceState(null, '', destination)
            setPage(readLocation())
          }
          void run()
        }}
      />
    )
  }

  const memberRoute = route === 'signin' ? 'rights' : route
  return (
    <MemberLayout locale={locale} navigate={navigate} route={memberRoute}>
      <MemberScreen
        key={locationKey}
        locale={locale}
        address={session.address}
        passIo={memberPassIo}
        queryClient={queryClient}
        queryUid={uidFromLocation(locationKey)}
        route={memberRoute}
        onNavigate={navigate}
        onSignOut={signOut}
        theme={theme}
        onThemeChange={onThemeChange}
        onLocaleChange={onLocaleChange}
      />
    </MemberLayout>
  )
}

export const App = ({ initialTheme = readThemeMode(), memberIo, memberPassIo }: AppProps): JSX.Element => {
  const [locale, updateLocale] = useState(getLocale)
  const [theme, setTheme] = useState(initialTheme)
  const copy = pick(MEMBER_COPY, locale)
  useEffect(() => {
    setLocale(locale)
  }, [locale])
  useEffect(() => {
    applyThemeMode(theme)
    return watchThemeMode(theme)
  }, [theme])
  const changeTheme = (mode: ThemeMode): void => {
    saveThemeMode(mode)
    setTheme(mode)
  }
  const appearance = (
    <div class="app-appearance" role="group" aria-label={copy.settings.appearance}>
      <LanguageSwitcher
        class="h-9 w-9"
        current={locale}
        label={copy.chrome.language}
        options={[
          { label: 'English', value: 'en' },
          { label: '日本語', value: 'ja' },
        ]}
        onChange={(value) => {
          if (isLocale(value)) {
            updateLocale(value)
          }
        }}
      />
      <ThemeToggle class="h-9 w-9" labels={copy.chrome.theme} mode={theme} onChange={changeTheme} />
    </div>
  )
  return (
    <div class="app-frame">
      <MemberApp
        locale={locale}
        memberIo={memberIo}
        memberPassIo={memberPassIo}
        appearance={appearance}
        theme={theme}
        onLocaleChange={updateLocale}
        onThemeChange={changeTheme}
      />
    </div>
  )
}
