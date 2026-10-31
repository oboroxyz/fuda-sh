import { isLocale, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { getLocale, setLocale } from '@fuda/i18n/browser'
import { createSessionGeneration, createTokenStore } from '@fuda/libs/auth'
import type { QueryClient } from '@fuda/libs/query'
import { createQueryScope } from '@fuda/libs/query/solid'
import { normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import {
  applyThemeMode,
  LanguageSwitcher,
  readThemeMode,
  saveThemeMode,
  ThemeToggle,
  watchThemeMode,
} from '@fuda/ui/solid'
import type { ThemeMode } from '@fuda/ui/solid'
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import type { JSX } from 'solid-js'

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
import { VenueScreen } from './venue/VenueScreen.tsx'

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
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Route is an internal parsed union; narrow the store display variant.
const isHomeRoute = (route: Route): route is { home: string } => typeof route === 'object' && 'home' in route

interface MemberScreenProps {
  locale: Locale
  address: Hex
  onSignOut: () => void
  onLocaleChange: (locale: Locale) => void
  onThemeChange: (theme: ThemeMode) => void
  theme: ThemeMode
  passIo?: MemberPassListIo
  queryClient: QueryClient
  queryUid: Hex | null
  route: MemberRoute
  onNavigate: (path: string) => void
}

const memberScreens = {
  private: (props: MemberScreenProps): JSX.Element => <PrivateScreen locale={props.locale} />,
  rights: (props: MemberScreenProps): JSX.Element => (
    <RightsList
      locale={props.locale}
      initialAddress={props.address}
      io={props.passIo}
      onNavigate={props.onNavigate}
      queryClient={props.queryClient}
      queryUid={props.queryUid}
    />
  ),
  settings: (props: MemberScreenProps): JSX.Element => (
    <Settings
      locale={props.locale}
      theme={props.theme}
      onLocaleChange={props.onLocaleChange}
      onThemeChange={props.onThemeChange}
      onSignOut={props.onSignOut}
      passIo={props.passIo}
    />
  ),
  signed: (props: MemberScreenProps): JSX.Element => <SignedGate locale={props.locale} />,
} satisfies Record<MemberRoute, (props: MemberScreenProps) => JSX.Element>

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

type Screen = 'card' | 'entry' | 'home' | 'member' | 'redirect' | 'restore' | 'signin' | 'top'

const isMemberRoute = (route: Route): route is MemberRoute =>
  route === 'private' || route === 'rights' || route === 'settings' || route === 'signed'

// A member screen is only built with a session; this placeholder never renders.
const NO_ADDRESS: Hex = `0x${'0'.repeat(40)}`

const MemberApp = (
  props: Omit<AppProps, 'initialTheme'> & {
    locale: Locale
    theme: ThemeMode
    onLocaleChange: (locale: Locale) => void
    onThemeChange: (theme: ThemeMode) => void
    appearance: JSX.Element
  },
): JSX.Element => {
  const memberIo = props.memberIo ?? DEFAULT_MEMBER_IO
  const copy = (): (typeof MEMBER_COPY)[Locale] => pick(MEMBER_COPY, props.locale)
  const queryClient = createQueryScope()
  const [page, setPage] = createSignal<LocationState>(readLocation())
  const route = (): Route => page().route
  const [session, setSession] = createSignal<MemberSession | null>(null)
  const savedToken = tokenStore.read()
  const [restore, setRestore] = createSignal<RestoreState>(savedToken === null ? null : 'loading')
  const [signingIn, setSigningIn] = createSignal(false)
  const [failure, setFailure] = createSignal<SignInFailure | null>(null)
  const generation = createSessionGeneration()
  let activeToken: string | null = savedToken
  let requestedReturn = initialReturn()
  let signInPending = false
  let signInAbort: AbortController | null = null
  let signInAttempt = 0

  const cancelSignIn = (): void => {
    signInAbort?.abort()
    signInAbort = null
    signInAttempt += 1
    generation.invalidate()
    signInPending = false
    setSigningIn(false)
  }

  const navigate = (path: string): void => {
    if (signInAbort !== null) {
      cancelSignIn()
    }
    history.pushState(null, '', path)
    setPage(readLocation())
  }

  const clearLocal = (): void => {
    const token = activeToken
    generation.invalidate()
    activeToken = null
    tokenStore.clear(token)
    queryClient.clear()
    batch(() => {
      setSession(null)
      setRestore(null)
      setSigningIn(false)
      setFailure(null)
    })
    signInPending = false
    signInAbort?.abort()
    signInAbort = null
    signInAttempt += 1
  }

  const signOut = (): void => {
    const token = activeToken
    clearLocal()
    history.pushState(null, '', '/')
    setPage(readLocation())
    if (token !== null) {
      void memberIo.logout(token)
    }
  }

  const restoreSession = (): void => {
    const token = activeToken
    if (token === null) {
      return
    }
    generation.invalidate()
    const ticket = generation.capture()
    setRestore('loading')
    const run = async (): Promise<void> => {
      const result = await memberIo.me(token)
      if (!generation.isCurrent(ticket) || activeToken !== token) {
        return
      }
      if (result.ok) {
        if (tokenStore.read() !== token) {
          clearLocal()
          return
        }
        batch(() => {
          setSession({ address: result.body.address, token })
          setRestore(null)
        })
        return
      }
      if (result.status === 401) {
        clearLocal()
      } else {
        setRestore('failed')
      }
    }
    void run()
  }

  onMount(() => {
    const onPopState = (): void => {
      if (signInAbort !== null) {
        cancelSignIn()
      }
      setPage(readLocation())
    }
    window.addEventListener('popstate', onPopState)
    onCleanup(() => {
      generation.invalidate()
      signInAbort?.abort()
      signInAttempt += 1
      queryClient.clear()
      window.removeEventListener('popstate', onPopState)
    })
  })
  onMount(restoreSession)

  const signedIn = createMemo(() => session() !== null)
  createEffect(
    on([route, signedIn], ([current, hasSession]) => {
      if (hasSession && current === 'signin') {
        history.replaceState(null, '', requestedReturn)
        setPage(readLocation())
        return
      }
      // A protected page reached while signed out is where sign-in returns to.
      if (!hasSession && isMemberRoute(current)) {
        requestedReturn = safeMemberReturn(pathAndQuery())
      }
    }),
  )

  const screen = createMemo((): Screen => {
    const current = route()
    if (isRedirectRoute(current)) {
      return 'redirect'
    }
    if (isHomeRoute(current)) {
      return 'home'
    }
    if (isCardRoute(current)) {
      return current.slug === null ? 'entry' : 'card'
    }
    if (current === 'top') {
      return 'top'
    }
    if (session() === null) {
      return restore() === null ? 'signin' : 'restore'
    }
    return 'member'
  })
  // Each screen is built once per identity: a venue, a card, or a member page
  // at one address. Session and locale updates reach the screen as props.
  const identity = createMemo(() => {
    const current = route()
    const kind = screen()
    if (isRedirectRoute(current)) {
      return `redirect:${current.redirect}`
    }
    if (isHomeRoute(current)) {
      return `home:${current.home}`
    }
    if (isCardRoute(current)) {
      return `${kind}:${current.card}/${current.slug ?? ''}`
    }
    return kind === 'member' ? `member:${page().key}` : kind
  })

  createEffect(() => {
    const current = route()
    if (isRedirectRoute(current)) {
      location.replace(current.redirect)
    }
  })

  const memberRoute = (): MemberRoute => {
    const current = route()
    return isMemberRoute(current) ? current : 'rights'
  }

  const onSignIn = (): void => {
    if (signInPending) {
      return
    }
    signInPending = true
    const abort = new AbortController()
    signInAbort = abort
    signInAttempt += 1
    const attempt = signInAttempt
    generation.invalidate()
    const ticket = generation.capture()
    const locationKey = page().key
    setSigningIn(true)
    setFailure(null)
    const run = async (): Promise<void> => {
      const outcome = await signInMember(memberIo, abort.signal)
      if (signInAttempt !== attempt || !generation.isCurrent(ticket) || pathAndQuery() !== locationKey) {
        if (signInAttempt === attempt && signInAbort === abort) {
          signInPending = false
          signInAbort = null
          setSigningIn(false)
        }
        return
      }
      signInPending = false
      signInAbort = null
      setSigningIn(false)
      if (!outcome.ok) {
        setFailure(outcome.failure)
        return
      }
      const next = outcome.session
      activeToken = next.token
      tokenStore.save(next.token)
      setSession(next)
      history.replaceState(null, '', requestedReturn)
      setPage(readLocation())
    }
    void run()
  }

  const venueHandle = (): string => {
    const current = route()
    if (isHomeRoute(current)) {
      return current.home
    }
    return isCardRoute(current) ? current.card : ''
  }
  const cardSlug = (): string | null => {
    const current = route()
    return isCardRoute(current) ? current.slug : null
  }

  const screens = {
    card: (): JSX.Element => <CardScreen handle={venueHandle()} slug={cardSlug()} locale={props.locale} />,
    entry: (): JSX.Element => <VenueScreen handle={venueHandle()} mode="entry" locale={props.locale} />,
    home: (): JSX.Element => <VenueScreen handle={venueHandle()} mode="home" locale={props.locale} />,
    member: (): JSX.Element => {
      const kind = memberRoute()
      // Built here, once: as a child expression it would be rebuilt whenever
      // the layout re-read it.
      const content = memberScreens[kind]({
        get address() {
          return session()?.address ?? NO_ADDRESS
        },
        get locale() {
          return props.locale
        },
        onLocaleChange: (next) => {
          props.onLocaleChange(next)
        },
        onNavigate: navigate,
        onSignOut: signOut,
        onThemeChange: (next) => {
          props.onThemeChange(next)
        },
        passIo: props.memberPassIo,
        queryClient,
        queryUid: uidFromLocation(page().key),
        route: kind,
        get theme() {
          return props.theme
        },
      })
      return (
        <MemberLayout locale={props.locale} navigate={navigate} route={kind}>
          {content}
        </MemberLayout>
      )
    },
    redirect: (): JSX.Element => <div class="p-6">{copy().auth.redirecting}</div>,
    restore: (): JSX.Element => (
      <main class="member-auth-page">
        <section class="member-panel flex w-full flex-col gap-4" role="status">
          <h1 class="member-heading">
            {restore() === 'loading' ? copy().auth.checking : copy().auth.failed}
          </h1>
          {restore() === 'failed' ? (
            <p class="text-sm text-[var(--fuda-muted)]">{copy().auth.preserved}</p>
          ) : null}
          <div class="flex flex-col gap-2 sm:flex-row">
            {restore() === 'failed' ? (
              <button class="btn btn-primary" type="button" onClick={restoreSession}>
                {copy().common.retry}
              </button>
            ) : null}
            <button class="btn btn-ghost" type="button" onClick={signOut}>
              {copy().auth.signOutLocal}
            </button>
          </div>
        </section>
      </main>
    ),
    signin: (): JSX.Element => (
      <SignIn
        locale={props.locale}
        busy={signingIn()}
        failure={failure()}
        onCancel={cancelSignIn}
        onNavigate={navigate}
        onSignIn={onSignIn}
      />
    ),
    top: (): JSX.Element => (
      <div class="app-top">
        {props.appearance}
        <Landing locale={props.locale} signedIn={signedIn()} onNavigate={navigate} />
      </div>
    ),
  } satisfies Record<Screen, () => JSX.Element>

  return (
    <Show when={identity()} keyed>
      {(_identity: string) => screens[screen()]()}
    </Show>
  )
}

export const App = (props: AppProps): JSX.Element => {
  const [locale, updateLocale] = createSignal(getLocale())
  const [theme, setTheme] = createSignal(props.initialTheme ?? readThemeMode())
  const copy = (): (typeof MEMBER_COPY)[Locale] => pick(MEMBER_COPY, locale())
  createEffect(() => {
    setLocale(locale())
  })
  createEffect(() => {
    const mode = theme()
    applyThemeMode(mode)
    onCleanup(watchThemeMode(mode))
  })
  const changeTheme = (mode: ThemeMode): void => {
    saveThemeMode(mode)
    setTheme(mode)
  }
  const appearance = (
    <div class="app-appearance" role="group" aria-label={copy().settings.appearance}>
      <LanguageSwitcher
        class="h-9 w-9"
        current={locale()}
        label={copy().chrome.language}
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
      <ThemeToggle class="h-9 w-9" labels={copy().chrome.theme} mode={theme()} onChange={changeTheme} />
    </div>
  )
  return (
    <div class="app-frame">
      <MemberApp
        locale={locale()}
        memberIo={props.memberIo}
        memberPassIo={props.memberPassIo}
        appearance={appearance}
        theme={theme()}
        onLocaleChange={(next) => {
          updateLocale(next)
        }}
        onThemeChange={changeTheme}
      />
    </div>
  )
}
