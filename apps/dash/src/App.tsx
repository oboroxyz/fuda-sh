/** @jsxImportSource hono/jsx/dom */
import { isLocale, pick } from '@fuda/i18n'
import { getLocale, setLocale } from '@fuda/i18n/browser'
import type { IssuerCreateResponse, IssuerMeResponse } from '@fuda/sdk'
import { LanguageSwitcher, saveThemeMode, ThemeToggle, watchThemeMode } from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import {
  checkCardSlug,
  checkHandle,
  issueRight,
  issuerMe,
  listMembers,
  revokeRight,
  signInChallenge,
  signInVerify,
  signOut,
} from './api.ts'
import { applyLogo, DEFAULT_DESIGN_IO, issueAndReload, revokeAndReload, submitDesign } from './app-actions.ts'
import type { ActionContext, DashIo } from './app-actions.ts'
import { hasIssuer, signedOutSession, unauthorizedSession } from './app-state.ts'
import type { SessionState } from './app-state.ts'
import type { CreateFailure, DesignerForm, DesignerMode } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { API_BASE_URL, GRAPH_RIGHTS_ENDPOINT } from './config.ts'
import { DASH_COPY } from './copy.ts'
import type { DashCopy } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import { IssueForm } from './IssueForm.tsx'
import type { IssueFormProps } from './IssueForm.tsx'
import type { LogoSet } from './logo.ts'
import { beginMembersLoad, completeMembersLoad, failMembersLoad } from './members-state.ts'
import type { MembersState } from './members-state.ts'
import { memberRowView } from './members-view.ts'
import { signInWithPasskey } from './operator-sign-in.ts'
import type { SignInFailure } from './operator-sign-in.ts'
import { OverviewPage } from './OverviewPage.tsx'
import { PublishedCard } from './PublishedCard.tsx'
import { RightsPage } from './RightsPage.tsx'
import type { RightsPageProps } from './RightsPage.tsx'
import { canonicalPath, homeFor, navigateTo, redirectFor, routeFromPath, subscribeToRoute } from './router.ts'
import type { DashRoute } from './router.ts'
import { SignIn, signInErrorOf } from './SignIn.tsx'
import { baseAccountProvider, personalSign, requestAccount } from './wallet.ts'

const DEFAULT_DASH_IO: DashIo = { issueRight, listMembers, revokeRight }

export interface AppProps {
  initialTheme: ThemeMode
  io?: DashIo
}

export interface AppViewProps {
  appearance: JSX.Element
  authError: 'unauthorized' | null
  copy: DashCopy
  createFailure: CreateFailure | null
  creating: boolean
  graphEndpoint: string
  members: MembersState
  onCheckHandle: (handle: string) => Promise<'available' | 'taken' | 'unknown'>
  onCheckSlug: (slug: string) => Promise<'available' | 'taken' | 'unknown'>
  onCommitLogo: (variants: LogoSet) => Promise<boolean>
  onCreate: (mode: DesignerMode, form: DesignerForm, logo: LogoSet | null) => void
  onIssue: IssueFormProps['onIssue']
  onNavigate: (route: DashRoute) => void
  onPasskey: () => void
  onRevoke: RightsPageProps['onRevoke']
  onSignOut: () => void
  onToken: (token: string) => void
  route: DashRoute
  session: SessionState
  signInError: SignInFailure | null
  signingIn: boolean
}

export const AppView = ({
  appearance,
  authError,
  copy,
  createFailure,
  creating,
  graphEndpoint,
  members,
  onCheckHandle,
  onCheckSlug,
  onCommitLogo,
  onCreate,
  onIssue,
  onNavigate,
  onPasskey,
  onRevoke,
  onSignOut,
  onToken,
  route,
  session,
  signInError,
  signingIn,
}: AppViewProps): JSX.Element => {
  const signInMessage = (): string | null => {
    if (signInError !== null) {
      return signInErrorOf(copy.auth, signInError)
    }
    return authError === 'unauthorized' ? copy.auth.unauthorized : null
  }

  if (session.token === null) {
    return (
      <SignIn
        appearance={appearance}
        copy={copy.auth}
        error={signInMessage()}
        onPasskey={onPasskey}
        onToken={onToken}
        pending={signingIn}
      />
    )
  }

  const { operator } = session
  const surface = operator === null ? 'admin' : 'operator'
  const published = operator !== null && operator.issuer !== null

  const page = (): JSX.Element => {
    if (operator !== null) {
      // `/new` stays open once the venue exists: it is how a second card is added.
      if (operator.issuer !== null && route !== '/new') {
        return (
          <PublishedCard
            cards={operator.cards}
            copy={copy.published}
            issuer={operator.issuer}
            logoCopy={copy.logo}
            onAddCard={() => {
              onNavigate('/new')
            }}
            onCommitLogo={onCommitLogo}
            publicUrl={operator.publicUrl}
          />
        )
      }
      return (
        <CardDesigner
          busy={creating}
          copy={copy.designer}
          failure={createFailure}
          issuer={operator.issuer}
          logoCopy={copy.logo}
          onCheckHandle={onCheckHandle}
          onCheckSlug={onCheckSlug}
          onSubmit={onCreate}
        />
      )
    }
    if (route === '/rights') {
      return <RightsPage copy={copy} graphEndpoint={graphEndpoint} members={members} onRevoke={onRevoke} />
    }
    if (route === '/issue') {
      return <IssueForm copy={copy.issue} onIssue={onIssue} />
    }
    return (
      <OverviewPage
        apiBaseUrl={API_BASE_URL}
        copy={copy.overview}
        graphEndpoint={graphEndpoint}
        state={members}
      />
    )
  }

  return (
    <DashboardShell
      appearance={appearance}
      copy={copy}
      hasIssuer={published}
      onNavigate={onNavigate}
      onSignOut={operator === null ? null : onSignOut}
      route={route}
      surface={surface}
    >
      {page()}
    </DashboardShell>
  )
}

// The venue after a create: the first card, or one more alongside the rest.
const operatorWith = (current: IssuerMeResponse | null, created: IssuerCreateResponse): IssuerMeResponse => {
  const existing = current !== null && current.issuer !== null ? current.cards : []
  return { cards: [...existing, created.card], issuer: created.issuer, publicUrl: created.publicUrl }
}

export const App = ({ initialTheme, io = DEFAULT_DASH_IO }: AppProps): JSX.Element => {
  const [route, setRoute] = useState<DashRoute>(() => routeFromPath(location.pathname))
  const [locale, updateLocale] = useState(getLocale)
  const [theme, setTheme] = useState(initialTheme)
  const [session, setSession] = useState<SessionState>(signedOutSession)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<SignInFailure | null>(null)
  const [creating, setCreating] = useState(false)
  const [createFailure, setCreateFailure] = useState<CreateFailure | null>(null)
  const latestMembersLoad = useRef(0)
  const { token } = session
  const activeToken = useRef(token)
  activeToken.current = token
  const copy = pick(DASH_COPY, locale)

  useEffect(() => {
    const path = canonicalPath(location.pathname)
    if (location.pathname !== path) {
      history.replaceState(null, '', path)
    }
    return subscribeToRoute(
      {
        addEventListener: (type, listener) => {
          window.addEventListener(type, listener)
        },
        pathname: () => location.pathname,
        removeEventListener: (type, listener) => {
          window.removeEventListener(type, listener)
        },
      },
      setRoute,
    )
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => watchThemeMode(theme), [theme])

  const reload = useCallback(
    async (currentToken: string): Promise<void> => {
      // A completed write may still carry a token from a replaced session.
      if (activeToken.current !== currentToken) {
        return
      }
      latestMembersLoad.current += 1
      const generation = latestMembersLoad.current
      setSession((state) =>
        state.token === currentToken ? { ...state, members: beginMembersLoad(state.members) } : state,
      )
      const result = await io.listMembers(currentToken)
      // Only the latest load can replace rows; any current-token 401 still ends the session.
      if (result.ok) {
        const rows = result.body.members.map((row) => memberRowView(row, API_BASE_URL))
        setSession((state) =>
          state.token === currentToken && generation === latestMembersLoad.current
            ? { ...state, members: completeMembersLoad(rows) }
            : state,
        )
        return
      }
      if (result.status === 401) {
        setSession((state) => (state.token === currentToken ? unauthorizedSession(state) : state))
        return
      }
      setSession((state) =>
        state.token === currentToken && generation === latestMembersLoad.current
          ? { ...state, members: failMembersLoad(state.members, result.error) }
          : state,
      )
    },
    [io],
  )

  // Only the console reads the D1 member list; a passkey session has no
  // admin authorization and must not ask for it.
  useEffect(() => {
    if (token !== null && session.operator === null) {
      void reload(token)
    }
  }, [token, reload, session.operator])

  // Each surface owns its own routes; landing on the other's is a redirect,
  // not a blank page.
  const published = hasIssuer(session)
  useEffect(() => {
    if (token === null) {
      return
    }
    const surface = session.operator === null ? 'admin' : 'operator'
    const target = redirectFor(route, surface, published)
    if (target !== null) {
      navigateTo(history, target)
      setRoute(target)
    }
  }, [published, route, session.operator, token])

  const context: ActionContext | null =
    token === null
      ? null
      : {
          io,
          onUnauthorized: () => {
            setSession((state) => (state.token === token ? unauthorizedSession(state) : state))
          },
          reload,
          token,
        }

  const appearance = (
    <div class="dash-appearance">
      <LanguageSwitcher
        current={locale}
        label={copy.chrome.language}
        options={[
          { label: copy.chrome.english, value: 'en' },
          { label: copy.chrome.japanese, value: 'ja' },
        ]}
        onChange={(value) => {
          if (isLocale(value)) {
            setLocale(value)
            updateLocale(value)
          }
        }}
      />
      <ThemeToggle
        labels={copy.chrome.theme}
        mode={theme}
        onChange={(mode) => {
          saveThemeMode(mode)
          setTheme(mode)
        }}
      />
    </div>
  )

  const onPasskey = (): void => {
    setSignInError(null)
    setSigningIn(true)
    const run = async (): Promise<void> => {
      const outcome = await signInWithPasskey({
        challenge: signInChallenge,
        issuerMe,
        personalSign,
        provider: baseAccountProvider,
        requestAccount,
        verify: signInVerify,
      })
      setSigningIn(false)
      if (!outcome.ok) {
        setSignInError(outcome.failure)
        return
      }
      setSession({
        authError: null,
        members: { kind: 'idle' },
        operator: outcome.issuer,
        token: outcome.token,
      })
      const target = homeFor('operator', outcome.issuer.issuer !== null)
      navigateTo(history, target)
      setRoute(target)
    }
    void run()
  }

  const onSignOut = (): void => {
    const run = async (): Promise<void> => {
      if (token !== null && session.operator !== null) {
        await signOut(token)
      }
      setSession(signedOutSession())
      setSignInError(null)
      navigateTo(history, '/')
      setRoute('/')
    }
    void run()
  }

  const onCheckHandle = useCallback(
    async (handle: string): Promise<'available' | 'taken' | 'unknown'> => {
      if (token === null) {
        return 'unknown'
      }
      const result = await checkHandle(token, handle)
      if (!result.ok) {
        return 'unknown'
      }
      return result.body.available ? 'available' : 'taken'
    },
    [token],
  )

  const onCheckSlug = useCallback(
    async (slug: string): Promise<'available' | 'taken' | 'unknown'> => {
      if (token === null) {
        return 'unknown'
      }
      const result = await checkCardSlug(token, slug)
      if (!result.ok) {
        return 'unknown'
      }
      return result.body.available ? 'available' : 'taken'
    },
    [token],
  )

  const onCreate = (mode: DesignerMode, form: DesignerForm, logo: LogoSet | null): void => {
    if (token === null) {
      setCreateFailure('input')
      return
    }
    setCreateFailure(null)
    setCreating(true)
    const run = async (): Promise<void> => {
      const outcome = await submitDesign(DEFAULT_DESIGN_IO, token, mode, form, logo)
      setCreating(false)
      if (!outcome.ok) {
        setCreateFailure(outcome.failure)
        if (outcome.failure === 'session') {
          setSession(unauthorizedSession)
        }
        return
      }
      setSession((state) => ({ ...state, operator: operatorWith(state.operator, outcome.body) }))
      navigateTo(history, '/published')
      setRoute('/published')
    }
    void run()
  }

  // The published screen changes a live venue's mark, which is a staged upload
  // spent by the commit route rather than by a create body.
  const onCommitLogo = async (variants: LogoSet): Promise<boolean> => {
    if (token === null) {
      return false
    }
    const outcome = await applyLogo(DEFAULT_DESIGN_IO, token, variants)
    if (!outcome.ok) {
      if (outcome.session) {
        setSession(unauthorizedSession)
      }
      return false
    }
    // The commit answers the updated issuer, whose `logoUrl` names the new
    // version; storing it is what makes the screen show the new mark.
    const { issuer } = outcome
    setSession((state) => {
      // Only a venue that already exists can have its logo replaced, so the
      // non-null arm of the operator union is the only one to update.
      const current = state.operator
      if (current === null || current.issuer === null) {
        return state
      }
      return { ...state, operator: { ...current, issuer } }
    })
    return true
  }

  return (
    <AppView
      appearance={appearance}
      authError={session.authError}
      copy={copy}
      createFailure={createFailure}
      creating={creating}
      graphEndpoint={GRAPH_RIGHTS_ENDPOINT}
      members={session.members}
      onCheckHandle={onCheckHandle}
      onCheckSlug={onCheckSlug}
      onCommitLogo={onCommitLogo}
      onCreate={onCreate}
      onIssue={async (body) =>
        context === null
          ? { error: 'unauthorized', network: false, ok: false, status: 401 }
          : await issueAndReload(context, body)
      }
      onNavigate={(nextRoute) => {
        if (nextRoute !== route) {
          navigateTo(history, nextRoute)
          setRoute(nextRoute)
        }
      }}
      onPasskey={onPasskey}
      onRevoke={async (uid) =>
        context === null
          ? { error: 'unauthorized', network: false, ok: false, status: 401 }
          : await revokeAndReload(context, uid)
      }
      onSignOut={onSignOut}
      onToken={(nextToken) => {
        setSession({ authError: null, members: { kind: 'idle' }, operator: null, token: nextToken })
      }}
      route={route}
      session={session}
      signInError={signInError}
      signingIn={signingIn}
    />
  )
}
