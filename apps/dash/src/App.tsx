/** @jsxImportSource hono/jsx/dom */
import { isLocale, pick } from '@fuda/i18n'
import { getLocale, setLocale } from '@fuda/i18n/browser'
import { LanguageSwitcher, saveThemeMode, ThemeToggle, watchThemeMode } from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { issueRight, listMembers, revokeRight } from './api.ts'
import { issueAndReload, revokeAndReload } from './app-actions.ts'
import type { ActionContext, DashIo } from './app-actions.ts'
import { unauthorizedSession } from './app-state.ts'
import type { SessionState } from './app-state.ts'
import { API_BASE_URL, GRAPH_RIGHTS_ENDPOINT } from './config.ts'
import { DASH_COPY } from './copy.ts'
import type { DashCopy } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import { IssueForm } from './IssueForm.tsx'
import type { IssueFormProps } from './IssueForm.tsx'
import { beginMembersLoad, completeMembersLoad, failMembersLoad } from './members-state.ts'
import type { MembersState } from './members-state.ts'
import { memberRowView } from './members-view.ts'
import { OverviewPage } from './OverviewPage.tsx'
import { RightsPage } from './RightsPage.tsx'
import type { RightsPageProps } from './RightsPage.tsx'
import { canonicalPath, navigateTo, routeFromPath, subscribeToRoute } from './router.ts'
import type { DashRoute } from './router.ts'
import { TokenGate } from './TokenGate.tsx'

const DEFAULT_DASH_IO: DashIo = { issueRight, listMembers, revokeRight }

export interface AppProps {
  initialTheme: ThemeMode
  io?: DashIo
}

export interface AppViewProps {
  appearance: JSX.Element
  authError: 'unauthorized' | null
  copy: DashCopy
  graphEndpoint: string
  members: MembersState
  onIssue: IssueFormProps['onIssue']
  onNavigate: (route: DashRoute) => void
  onRevoke: RightsPageProps['onRevoke']
  onToken: (token: string) => void
  route: DashRoute
  token: string | null
}

export const AppView = ({
  appearance,
  authError,
  copy,
  graphEndpoint,
  members,
  onIssue,
  onNavigate,
  onRevoke,
  onToken,
  route,
  token,
}: AppViewProps): JSX.Element => {
  if (token === null) {
    return (
      <TokenGate
        appearance={appearance}
        copy={copy.auth}
        error={authError === 'unauthorized' ? copy.auth.unauthorized : null}
        onToken={onToken}
      />
    )
  }

  const page = (): JSX.Element => {
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
    <DashboardShell appearance={appearance} copy={copy} onNavigate={onNavigate} route={route}>
      {page()}
    </DashboardShell>
  )
}

export const App = ({ initialTheme, io = DEFAULT_DASH_IO }: AppProps): JSX.Element => {
  const [route, setRoute] = useState<DashRoute>(() => routeFromPath(location.pathname))
  const [locale, updateLocale] = useState(getLocale)
  const [theme, setTheme] = useState(initialTheme)
  const [session, setSession] = useState<SessionState>({
    authError: null,
    members: { kind: 'idle' },
    token: null,
  })
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

  useEffect(() => {
    if (token !== null) {
      void reload(token)
    }
  }, [token, reload])

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

  return (
    <AppView
      appearance={appearance}
      authError={session.authError}
      copy={copy}
      graphEndpoint={GRAPH_RIGHTS_ENDPOINT}
      members={session.members}
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
      onRevoke={async (uid) =>
        context === null
          ? { error: 'unauthorized', network: false, ok: false, status: 401 }
          : await revokeAndReload(context, uid)
      }
      onToken={(nextToken) => {
        setSession({ authError: null, members: { kind: 'idle' }, token: nextToken })
      }}
      route={route}
      token={token}
    />
  )
}
