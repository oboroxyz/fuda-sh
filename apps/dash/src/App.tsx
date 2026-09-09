/** @jsxImportSource hono/jsx/dom */
import { isLocale, pick } from '@fuda/i18n'
import { getLocale, setLocale } from '@fuda/i18n/browser'
import { QueryError, readQueryResult, useQuery, useQueryScope } from '@fuda/libs/query'
import type {
  CardCreateResponse,
  IssuerCreateResponse,
  IssuerMeResponse,
  IssuerUpdateRequest,
} from '@fuda/sdk'
import { LanguageSwitcher, saveThemeMode, ThemeToggle, watchThemeMode } from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { issueRight, listMembers, revokeRight } from './api.ts'
import { applyLogo, issueAndReload, revokeAndReload, submitCard, submitVenue } from './app-actions.ts'
import type { ActionContext, CardCreateOutcome, DashIo, VenueCreateOutcome } from './app-actions.ts'
import { hasIssuer, signedOutSession, unauthorizedSession } from './app-state.ts'
import type { SessionState } from './app-state.ts'
import { AppView } from './AppView.tsx'
import type { CreateFailure, DesignerForm, DesignerMode } from './card-designer.ts'
import { API_BASE_URL, GRAPH_RIGHTS_ENDPOINT } from './config.ts'
import { DASH_COPY } from './copy.ts'
import type { ClaimState } from './ens-claim.ts'
import { initialClaimState, reconcileClaimState, runClaim } from './ens-claim.ts'
import { readPendingEnsClaim, reconcilePendingEnsClaim, writePendingEnsClaim } from './ens-pending.ts'
import { EnsClaim } from './EnsClaim.tsx'
import type { LogoSet } from './logo.ts'
import { beginMembersLoad, completeMembersLoad, failMembersLoad } from './members-state.ts'
import { memberRowView } from './members-view.ts'
import { DEFAULT_OPERATOR_IO } from './operator-io.ts'
import type { OperatorIo } from './operator-io.ts'
import { clearOperatorToken, readOperatorToken, saveOperatorToken } from './operator-session.ts'
import type { SignInFailure } from './operator-sign-in.ts'
import { canonicalPath, homeFor, navigateTo, redirectFor, routeFromPath, subscribeToRoute } from './router.ts'
import type { DashRoute } from './router.ts'
import { createSessionGeneration } from './session-generation.ts'
import type { VenueForm } from './venue.ts'

const issuerKey = (generation: number) => ['issuer', API_BASE_URL, generation] as const

const DEFAULT_DASH_IO: DashIo = { issueRight, listMembers, revokeRight }

export interface AppProps {
  initialTheme: ThemeMode
  io?: DashIo
  operatorIo?: OperatorIo
}

// The venue after a create: the first card, or one more alongside the rest.
const operatorWithCard = (
  current: IssuerMeResponse | null,
  created: CardCreateResponse,
): IssuerMeResponse => {
  const existing = current !== null && current.issuer !== null ? current.cards : []
  return {
    cards: [...existing, created.card],
    // A create says nothing about the ENS name; the next /issuers/me read carries it.
    ens: current?.ens ?? null,
    issuer: created.issuer,
    publicUrl: created.publicUrl,
  }
}

const operatorWithVenue = (created: IssuerCreateResponse): IssuerMeResponse => created

export const App = ({
  initialTheme,
  io = DEFAULT_DASH_IO,
  operatorIo = DEFAULT_OPERATOR_IO,
}: AppProps): JSX.Element => {
  const queryClient = useQueryScope()
  const [route, setRoute] = useState<DashRoute>(() => routeFromPath(location.pathname))
  const [locale, updateLocale] = useState(getLocale)
  const [theme, setTheme] = useState(initialTheme)
  const [session, setSession] = useState<SessionState>(signedOutSession)
  const [savedToken] = useState(readOperatorToken)
  const restoringToken = useRef(savedToken)
  const [restoreState, setRestoreState] = useState<'loading' | 'failed' | null>(
    savedToken === null ? null : 'loading',
  )
  const [claimState, setClaimState] = useState<ClaimState>(() => initialClaimState(null))
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<SignInFailure | null>(null)
  const [creating, setCreating] = useState(false)
  const [createFailure, setCreateFailure] = useState<CreateFailure | null>(null)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [generation] = useState(createSessionGeneration)
  const latestMembersLoad = useRef(0)
  const activeSession = useRef(session)
  activeSession.current = session
  const { token } = session
  const activeToken = useRef(token)
  activeToken.current = token
  const copy = pick(DASH_COPY, locale)

  const replaceSession = useCallback(
    (next: SessionState): void => {
      generation.invalidate()
      queryClient.clear()
      if (next.operator === null) {
        clearOperatorToken(activeToken.current ?? restoringToken.current)
      }
      restoringToken.current = null
      setRestoreState(null)
      activeSession.current = next
      activeToken.current = next.token
      setSession(next)
      setSessionRevision((value) => value + 1)
      setCreating(false)
      setCreateFailure(null)
      setSigningIn(false)
      setSignInError(null)
      const pending =
        next.operator?.issuer === null || next.operator?.issuer === undefined
          ? null
          : reconcilePendingEnsClaim(next.operator.issuer.id, next.operator.ens)
      setClaimState(
        pending === null
          ? initialClaimState(next.operator?.ens ?? null)
          : { failure: 'unconfirmed', kind: 'failed', ...pending },
      )
    },
    [generation, queryClient],
  )

  const restoreSession = useCallback((): void => {
    const storedToken = restoringToken.current
    if (storedToken === null) {
      return
    }
    generation.invalidate()
    const ticket = generation.capture()
    setRestoreState('loading')
    const run = async (): Promise<void> => {
      let operator: IssuerMeResponse
      try {
        operator = await queryClient.query({
          queryFn: async () => readQueryResult(await operatorIo.issuerMe(storedToken)),
          queryKey: issuerKey(ticket),
          retry: false,
          staleTime: 0,
        })
      } catch (error) {
        if (generation.isCurrent(ticket)) {
          if (error instanceof QueryError && error.status === 401) {
            replaceSession(unauthorizedSession(activeSession.current))
          } else {
            setRestoreState('failed')
          }
        }
        return
      }
      if (!generation.isCurrent(ticket)) {
        return
      }
      if (readOperatorToken() !== storedToken) {
        replaceSession(signedOutSession())
        return
      }
      replaceSession({
        ...signedOutSession(),
        operator,
        token: storedToken,
      })
    }
    void run()
  }, [generation, operatorIo, queryClient, replaceSession])

  const issuerTicket = generation.capture()
  const issuerQuery = useQuery<IssuerMeResponse>(queryClient, {
    enabled: token !== null && session.operator !== null,
    initialData: session.operator ?? undefined,
    queryFn: async () => readQueryResult(await operatorIo.issuerMe(token ?? '')),
    queryKey: issuerKey(issuerTicket),
  })

  useEffect(() => {
    if (!generation.isCurrent(issuerTicket) || token === null || activeToken.current !== token) {
      return
    }
    if (issuerQuery.error instanceof QueryError && issuerQuery.error.status === 401) {
      replaceSession(unauthorizedSession(activeSession.current))
      return
    }
    const operator = issuerQuery.data
    if (operator !== undefined && activeSession.current.operator !== null) {
      const previousEnsName = activeSession.current.operator.ens?.name
      setSession((state) => (state.operator === operator ? state : { ...state, operator }))
      const pending =
        operator.issuer === null ? null : reconcilePendingEnsClaim(operator.issuer.id, operator.ens)
      setClaimState((state) => reconcileClaimState(state, operator.ens, pending, previousEnsName))
    }
  }, [generation, issuerTicket, issuerQuery.data, issuerQuery.error, replaceSession, token])

  const updateOperator = (operator: IssuerMeResponse): void => {
    const queryKey = issuerKey(generation.capture())
    void queryClient.cancelQueries({ exact: true, queryKey })
    queryClient.setQueryData(queryKey, operator)
    const next = { ...activeSession.current, operator }
    activeSession.current = next
    setSession(next)
  }

  useEffect(restoreSession, [restoreSession])

  useEffect(
    () => () => {
      generation.invalidate()
    },
    [generation],
  )

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
    async (currentToken: string, ticket = generation.capture()): Promise<void> => {
      // A completed write may still carry a token from a replaced session.
      if (!generation.isCurrent(ticket) || activeToken.current !== currentToken) {
        return
      }
      latestMembersLoad.current += 1
      const memberGeneration = latestMembersLoad.current
      setSession((state) =>
        state.token === currentToken ? { ...state, members: beginMembersLoad(state.members) } : state,
      )
      let result: Awaited<ReturnType<DashIo['listMembers']>>
      try {
        result = await io.listMembers(currentToken)
      } catch {
        return
      }
      if (!generation.isCurrent(ticket) || activeToken.current !== currentToken) {
        return
      }
      // Only the latest load can replace rows; any current-token 401 still ends the session.
      if (result.ok) {
        const rows = result.body.members.map((row) => memberRowView(row, API_BASE_URL))
        setSession((state) =>
          state.token === currentToken && memberGeneration === latestMembersLoad.current
            ? { ...state, members: completeMembersLoad(rows) }
            : state,
        )
        return
      }
      if (result.status === 401) {
        replaceSession(unauthorizedSession(activeSession.current))
        return
      }
      setSession((state) =>
        state.token === currentToken && memberGeneration === latestMembersLoad.current
          ? { ...state, members: failMembersLoad(state.members, result.error) }
          : state,
      )
    },
    [generation, io, replaceSession],
  )

  // Only the console reads the D1 member list; a passkey session has no
  // admin authorization and must not ask for it.
  useEffect(() => {
    if (token !== null && session.operator === null) {
      void reload(token)
    }
  }, [sessionRevision, token, reload, session.operator])

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

  const sessionTicket = generation.capture()
  const context: ActionContext | null =
    token === null
      ? null
      : {
          io,
          onUnauthorized: () => {
            if (generation.isCurrent(sessionTicket) && activeToken.current === token) {
              replaceSession(unauthorizedSession(activeSession.current))
            }
          },
          reload: async (currentToken) => {
            await reload(currentToken, sessionTicket)
          },
          token,
        }

  const appearance = (
    <div class="dash-appearance">
      <LanguageSwitcher
        class="h-9 w-9"
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
        class="h-9 w-9"
        labels={copy.chrome.theme}
        mode={theme}
        onChange={(mode) => {
          saveThemeMode(mode)
          setTheme(mode)
        }}
      />
    </div>
  )

  // The venue's ENS claim. `ens` is null until /issuers/me says this deployment
  // has a parent name, and the section is left out entirely in that case rather
  // than offering a button that could only fail.
  const ensName = session.operator?.ens?.name ?? null
  const ensOwner = session.operator?.issuer?.operatorAddress ?? null
  const ensSection =
    ensName === null || ensOwner === null || session.token === null ? null : (
      <EnsClaim
        copy={copy.ens}
        name={ensName}
        ownerAddress={ensOwner}
        onClaim={() => {
          const { token: sessionToken } = session
          if (sessionToken === null) {
            return
          }
          const ticket = generation.capture()
          const guardedEmit = (next: ClaimState): void => {
            if (generation.isCurrent(ticket)) {
              setClaimState(next)
            }
          }
          const run = async (): Promise<void> => {
            try {
              const issuerId = activeSession.current.operator?.issuer?.id
              let pending = issuerId === undefined ? undefined : (readPendingEnsClaim(issuerId) ?? undefined)
              if (
                claimState.kind === 'failed' &&
                claimState.txHash !== undefined &&
                claimState.name !== undefined
              ) {
                pending = { name: claimState.name, txHash: claimState.txHash }
              }
              const result = await runClaim(operatorIo.claim(sessionToken), guardedEmit, pending, (next) => {
                if (
                  generation.isCurrent(ticket) &&
                  activeToken.current === sessionToken &&
                  issuerId !== undefined
                ) {
                  writePendingEnsClaim(issuerId, next)
                }
              })
              if (result.kind === 'claimed' && generation.isCurrent(ticket)) {
                const current = activeSession.current.operator
                if (current !== null && current.ens !== null) {
                  updateOperator({
                    ...current,
                    ens: {
                      ...current.ens,
                      claimTxHash: result.claimTxHash,
                      name: result.name,
                      status: 'claimed',
                    },
                  })
                }
                await queryClient.invalidateQueries({ exact: true, queryKey: issuerKey(ticket) })
              }
            } catch {
              // A rejected old claim cannot change local state.
            }
          }
          void run()
        }}
        state={claimState}
      />
    )

  const onPasskey = (): void => {
    generation.invalidate()
    const ticket = generation.capture()
    setSignInError(null)
    setSigningIn(true)
    const run = async (): Promise<void> => {
      let outcome: Awaited<ReturnType<OperatorIo['signIn']>>
      try {
        outcome = await operatorIo.signIn()
      } catch {
        if (!generation.isCurrent(ticket)) {
          return
        }
        setSigningIn(false)
        setSignInError('network')
        return
      }
      if (!generation.isCurrent(ticket)) {
        return
      }
      setSigningIn(false)
      if (!outcome.ok) {
        setSignInError(outcome.failure)
        return
      }
      saveOperatorToken(outcome.token)
      replaceSession({
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
    const oldToken = token ?? restoringToken.current
    const hadOperator = session.operator !== null || restoringToken.current !== null
    replaceSession(signedOutSession())
    navigateTo(history, '/')
    setRoute('/')
    if (oldToken !== null && hadOperator) {
      const run = async (): Promise<void> => {
        try {
          await operatorIo.signOut(oldToken)
        } catch {
          // Remote sign-out failure cannot restore the locally signed-out session.
        }
      }
      void run()
    }
  }

  const onCheckHandle = useCallback(
    async (handle: string): Promise<'available' | 'taken' | 'unknown'> => {
      if (token === null) {
        return 'unknown'
      }
      const sessionToken = token
      const ticket = generation.capture()
      let result: Awaited<ReturnType<OperatorIo['checkHandle']>>
      try {
        result = await operatorIo.checkHandle(sessionToken, handle)
      } catch {
        return 'unknown'
      }
      if (!generation.isCurrent(ticket) || activeToken.current !== sessionToken) {
        return 'unknown'
      }
      if (!result.ok) {
        if (result.status === 401) {
          replaceSession(unauthorizedSession(activeSession.current))
        }
        return 'unknown'
      }
      return result.body.available ? 'available' : 'taken'
    },
    [generation, operatorIo, replaceSession, token],
  )

  const onCheckSlug = useCallback(
    async (slug: string): Promise<'available' | 'taken' | 'unknown'> => {
      if (token === null) {
        return 'unknown'
      }
      const sessionToken = token
      const ticket = generation.capture()
      let result: Awaited<ReturnType<OperatorIo['checkSlug']>>
      try {
        result = await operatorIo.checkSlug(sessionToken, slug)
      } catch {
        return 'unknown'
      }
      if (!generation.isCurrent(ticket) || activeToken.current !== sessionToken) {
        return 'unknown'
      }
      if (!result.ok) {
        if (result.status === 401) {
          replaceSession(unauthorizedSession(activeSession.current))
        }
        return 'unknown'
      }
      return result.body.available ? 'available' : 'taken'
    },
    [generation, operatorIo, replaceSession, token],
  )

  const runCreate = <T,>(
    submit: () => Promise<{ ok: true; body: T } | { ok: false; failure: CreateFailure }>,
    apply: (body: T) => IssuerMeResponse,
    target: DashRoute,
  ): void => {
    if (token === null) {
      setCreateFailure('input')
      return
    }
    const sessionToken = token
    const ticket = generation.capture()
    setCreateFailure(null)
    setCreating(true)
    const run = async (): Promise<void> => {
      let outcome: Awaited<ReturnType<typeof submit>>
      try {
        outcome = await submit()
      } catch {
        if (!generation.isCurrent(ticket) || activeToken.current !== sessionToken) {
          return
        }
        setCreating(false)
        setCreateFailure('network')
        return
      }
      if (!generation.isCurrent(ticket) || activeToken.current !== sessionToken) {
        return
      }
      if (!outcome.ok && outcome.failure === 'session') {
        replaceSession(unauthorizedSession(activeSession.current))
        return
      }
      setCreating(false)
      if (!outcome.ok) {
        setCreateFailure(outcome.failure)
        return
      }
      updateOperator(apply(outcome.body))
      navigateTo(history, target)
      setRoute(target)
    }
    void run()
  }

  const onCreate = (_mode: DesignerMode, form: DesignerForm): void => {
    runCreate(
      async (): Promise<CardCreateOutcome> => await submitCard(operatorIo.design, token ?? '', form),
      (body) => operatorWithCard(activeSession.current.operator, body),
      '/cards',
    )
  }

  const onCreateVenue = (form: VenueForm, logo: LogoSet | null): void => {
    runCreate(
      async (): Promise<VenueCreateOutcome> => await submitVenue(operatorIo.design, token ?? '', form, logo),
      operatorWithVenue,
      '/profile',
    )
  }

  // The published screen changes a live venue's mark, which is a staged upload
  // spent by the commit route rather than by a create body.
  const onCommitLogo = async (variants: LogoSet): Promise<boolean> => {
    if (token === null) {
      return false
    }
    const sessionToken = token
    const ticket = generation.capture()
    let outcome: Awaited<ReturnType<typeof applyLogo>>
    try {
      outcome = await applyLogo(operatorIo.design, sessionToken, variants)
    } catch {
      return false
    }
    if (!generation.isCurrent(ticket) || activeToken.current !== sessionToken) {
      return false
    }
    if (!outcome.ok) {
      if (outcome.session) {
        replaceSession(unauthorizedSession(activeSession.current))
      }
      return false
    }
    // The commit answers the updated issuer, whose `logoUrl` names the new
    // version; storing it is what makes the screen show the new mark.
    const { issuer } = outcome
    const current = activeSession.current.operator
    if (current !== null && current.issuer !== null) {
      updateOperator({ ...current, issuer: { ...current.issuer, logoUrl: issuer.logoUrl } })
    }
    return true
  }

  const onUpdateVenue = async (body: IssuerUpdateRequest): Promise<boolean> => {
    if (token === null || (activeSession.current.operator?.issuer ?? null) === null) {
      return false
    }
    const sessionToken = token
    const ticket = generation.capture()
    let result: Awaited<ReturnType<OperatorIo['updateIssuer']>>
    try {
      result = await operatorIo.updateIssuer(sessionToken, body)
    } catch {
      return false
    }
    if (!generation.isCurrent(ticket) || activeToken.current !== sessionToken) {
      return false
    }
    if (!result.ok) {
      if (result.status === 401) {
        replaceSession(unauthorizedSession(activeSession.current))
      }
      return false
    }
    const current = activeSession.current.operator
    if (current === null || current.issuer === null || current.issuer.id !== result.body.issuer.id) {
      return false
    }
    const { brandColor, name, tagline } = result.body.issuer
    // A concurrent logo commit owns logoUrl; a profile response only owns these fields.
    updateOperator({ ...current, issuer: { ...current.issuer, brandColor, name, tagline } })
    return true
  }

  const readStamps = useCallback(
    async (cardId: string) => {
      const sessionToken = token ?? ''
      const ticket = generation.capture()
      const result = await operatorIo.readStampSettings(sessionToken, cardId)
      if (
        !result.ok &&
        result.status === 401 &&
        generation.isCurrent(ticket) &&
        activeToken.current === sessionToken
      ) {
        replaceSession(unauthorizedSession(activeSession.current))
      }
      return result
    },
    [generation, operatorIo, replaceSession, token],
  )
  const saveStamps = useCallback(
    async (cardId: string, settings: Parameters<OperatorIo['updateStampSettings']>[2]) => {
      const sessionToken = token ?? ''
      const ticket = generation.capture()
      const result = await operatorIo.updateStampSettings(sessionToken, cardId, settings)
      if (
        !result.ok &&
        result.status === 401 &&
        generation.isCurrent(ticket) &&
        activeToken.current === sessionToken
      ) {
        replaceSession(unauthorizedSession(activeSession.current))
      }
      return result
    },
    [generation, operatorIo, replaceSession, token],
  )
  const receiveAtReception = useCallback(
    async (qr: string, requestId: string) => {
      const sessionToken = token ?? ''
      const ticket = generation.capture()
      const result = await operatorIo.receiveAtReception(sessionToken, qr, requestId)
      if (
        !result.ok &&
        result.status === 401 &&
        generation.isCurrent(ticket) &&
        activeToken.current === sessionToken
      ) {
        replaceSession(unauthorizedSession(activeSession.current))
      }
      return result
    },
    [generation, operatorIo, replaceSession, token],
  )

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
      onCreateVenue={onCreateVenue}
      onUpdateVenue={onUpdateVenue}
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
      ens={ensSection}
      onPasskey={onPasskey}
      onRestore={restoreSession}
      restoreState={restoreState}
      onRevoke={async (uid) =>
        context === null
          ? { error: 'unauthorized', network: false, ok: false, status: 401 }
          : await revokeAndReload(context, uid)
      }
      onSignOut={onSignOut}
      onToken={(nextToken) => {
        replaceSession({ authError: null, members: { kind: 'idle' }, operator: null, token: nextToken })
      }}
      receiveAtReception={receiveAtReception}
      route={route}
      session={session}
      signInError={signInError}
      signingIn={signingIn}
      stampSettings={{ load: readStamps, save: saveStamps }}
    />
  )
}
