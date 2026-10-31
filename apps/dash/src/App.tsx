import { isLocale, pick } from '@fuda/i18n'
import { getLocale, setLocale } from '@fuda/i18n/browser'
import { QueryError, readQueryResult } from '@fuda/libs/query'
import { createQuery, createQueryScope } from '@fuda/libs/query/solid'
import type {
  CardCreateResponse,
  IssuerCreateResponse,
  IssuerMeResponse,
  IssuerUpdateRequest,
} from '@fuda/sdk'
import { LanguageSwitcher, saveThemeMode, ThemeToggle, watchThemeMode } from '@fuda/ui/solid'
import type { ThemeMode } from '@fuda/ui/solid'
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { issueRight, listMembers, revokeRight } from './api.ts'
import type { Result } from './api.ts'
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
import {
  canonicalPath,
  cardForRoute,
  cardEditPath,
  cardSettingsPath,
  isCardEditRoute,
  isLegacyCardSettingsRoute,
  homeFor,
  navigateTo,
  redirectFor,
  routeFromPath,
  subscribeToRoute,
} from './router.ts'
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

export const App = (props: AppProps): JSX.Element => {
  const io = props.io ?? DEFAULT_DASH_IO
  const operatorIo = props.operatorIo ?? DEFAULT_OPERATOR_IO
  const queryClient = createQueryScope()
  const [route, setRoute] = createSignal<DashRoute>(routeFromPath(location.pathname))
  const [locale, updateLocale] = createSignal(getLocale())
  const [theme, setTheme] = createSignal(props.initialTheme)
  const [session, setSession] = createSignal<SessionState>(signedOutSession())
  const savedToken = readOperatorToken()
  let restoringToken = savedToken
  const [restoreState, setRestoreState] = createSignal<'loading' | 'failed' | null>(
    savedToken === null ? null : 'loading',
  )
  const [claimState, setClaimState] = createSignal<ClaimState>(initialClaimState(null))
  const [signingIn, setSigningIn] = createSignal(false)
  const [signInError, setSignInError] = createSignal<SignInFailure | null>(null)
  const [creating, setCreating] = createSignal(false)
  const [createFailure, setCreateFailure] = createSignal<CreateFailure | null>(null)
  const [cardDraft, setCardDraft] = createSignal<DesignerForm | null>(null)
  const [sessionRevision, setSessionRevision] = createSignal(0)
  const generation = createSessionGeneration()
  // Bumped with every invalidation, so readers of the current ticket recompute.
  const [generationVersion, setGenerationVersion] = createSignal(0)
  const invalidate = (): void => {
    generation.invalidate()
    setGenerationVersion((value) => value + 1)
  }
  let latestMembersLoad = 0
  const latestCardSave = new Map<string, symbol>()
  let latestDefaultSave: symbol | null = null
  // Signals update synchronously, so the latest session is always session().
  // Derived values are memos: an effect keyed on them runs when the value
  // changes, not on every session update (members loads write the session too).
  const token = createMemo(() => session().token)
  const sessionOperator = createMemo(() => session().operator)
  const isAdmin = createMemo(() => token() !== null && sessionOperator() === null)
  const copy = createMemo(() => pick(DASH_COPY, locale()))

  // One session change, applied as a unit: effects keyed on the session see it
  // once, not once per field.
  const replaceSession = (next: SessionState): void => {
    batch(() => {
      invalidate()
      latestCardSave.clear()
      latestDefaultSave = null
      queryClient.clear()
      if (next.operator === null) {
        clearOperatorToken(token() ?? restoringToken)
      }
      restoringToken = null
      setRestoreState(null)
      setSession(next)
      setSessionRevision((value) => value + 1)
      setCreating(false)
      setCreateFailure(null)
      setCardDraft(null)
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
    })
  }

  const restoreSession = (): void => {
    const storedToken = restoringToken
    if (storedToken === null) {
      return
    }
    invalidate()
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
            replaceSession(unauthorizedSession(session()))
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
  }

  const issuerTicket = createMemo(() => {
    generationVersion()
    return generation.capture()
  })
  const issuerQuery = createQuery<IssuerMeResponse>(queryClient, () => ({
    enabled: token() !== null && session().operator !== null,
    initialData: session().operator ?? undefined,
    queryFn: async () => readQueryResult(await operatorIo.issuerMe(token() ?? '')),
    queryKey: issuerKey(issuerTicket()),
  }))

  createEffect(
    on(
      [issuerTicket, () => issuerQuery().data, () => issuerQuery().error, token],
      ([ticket, operator, error, current]) => {
        if (!generation.isCurrent(ticket) || current === null || token() !== current) {
          return
        }
        if (error instanceof QueryError && error.status === 401) {
          replaceSession(unauthorizedSession(session()))
          return
        }
        const active = session().operator
        if (operator !== undefined && active !== null) {
          const previousEnsName = active.ens?.name
          setSession((state) => (state.operator === operator ? state : { ...state, operator }))
          const pending =
            operator.issuer === null ? null : reconcilePendingEnsClaim(operator.issuer.id, operator.ens)
          setClaimState((state) => reconcileClaimState(state, operator.ens, pending, previousEnsName))
        }
      },
    ),
  )

  const updateOperator = (operator: IssuerMeResponse): void => {
    const queryKey = issuerKey(generation.capture())
    void queryClient.cancelQueries({ exact: true, queryKey })
    queryClient.setQueryData(queryKey, operator)
    setSession({ ...session(), operator })
  }

  onMount(restoreSession)

  onCleanup(() => {
    generation.invalidate()
  })

  onMount(() => {
    const path = canonicalPath(location.pathname)
    if (location.pathname !== path) {
      history.replaceState(null, '', path)
    }
    onCleanup(
      subscribeToRoute(
        {
          addEventListener: (type, listener) => {
            window.addEventListener(type, listener)
          },
          pathname: () => location.pathname,
          removeEventListener: (type, listener) => {
            window.removeEventListener(type, listener)
          },
        },
        (next) => {
          setRoute(next)
        },
      ),
    )
  })

  createEffect(() => {
    document.documentElement.lang = locale()
  })

  createEffect(() => {
    onCleanup(watchThemeMode(theme()))
  })

  const reload = async (currentToken: string, ticket = generation.capture()): Promise<void> => {
    // A completed write may still carry a token from a replaced session.
    if (!generation.isCurrent(ticket) || token() !== currentToken) {
      return
    }
    latestMembersLoad += 1
    const memberGeneration = latestMembersLoad
    setSession((state) =>
      state.token === currentToken ? { ...state, members: beginMembersLoad(state.members) } : state,
    )
    let result: Awaited<ReturnType<DashIo['listMembers']>>
    try {
      result = await io.listMembers(currentToken)
    } catch {
      return
    }
    if (!generation.isCurrent(ticket) || token() !== currentToken) {
      return
    }
    // Only the latest load can replace rows; any current-token 401 still ends the session.
    if (result.ok) {
      const rows = result.body.members.map((row) => memberRowView(row, API_BASE_URL))
      setSession((state) =>
        state.token === currentToken && memberGeneration === latestMembersLoad
          ? { ...state, members: completeMembersLoad(rows) }
          : state,
      )
      return
    }
    if (result.status === 401) {
      replaceSession(unauthorizedSession(session()))
      return
    }
    setSession((state) =>
      state.token === currentToken && memberGeneration === latestMembersLoad
        ? { ...state, members: failMembersLoad(state.members, result.error) }
        : state,
    )
  }

  // Only the console reads the D1 member list; a passkey session has no
  // admin authorization and must not ask for it.
  createEffect(
    on([sessionRevision, isAdmin], ([, admin]) => {
      const current = token()
      if (current !== null && admin) {
        void reload(current)
      }
    }),
  )

  // Each surface owns its own routes; landing on the other's is a redirect,
  // not a blank page.
  const published = createMemo(() => hasIssuer(session()))
  createEffect(
    on([published, route, sessionOperator, token], ([isPublished, current, active, activeToken]) => {
      if (activeToken === null) {
        return
      }
      const surface = active === null ? 'admin' : 'operator'
      const target = redirectFor(current, surface, isPublished)
      if (target !== null) {
        navigateTo(history, target)
        setRoute(target)
        return
      }
      const card = cardForRoute(current, active?.cards ?? [])
      if (card !== null) {
        const cardRoute =
          isCardEditRoute(current) || isLegacyCardSettingsRoute(current)
            ? cardEditPath(card)
            : cardSettingsPath(card)
        if (cardRoute !== current) {
          history.replaceState(null, '', cardRoute)
          setRoute(cardRoute)
        }
      }
    }),
  )

  const actionContext = (): ActionContext | null => {
    const current = token()
    if (current === null) {
      return null
    }
    const sessionTicket = generation.capture()
    return {
      io,
      onUnauthorized: () => {
        if (generation.isCurrent(sessionTicket) && token() === current) {
          replaceSession(unauthorizedSession(session()))
        }
      },
      reload: async (currentToken) => {
        await reload(currentToken, sessionTicket)
      },
      token: current,
    }
  }

  const appearance = (
    <div class="dash-appearance">
      <LanguageSwitcher
        class="h-9 w-9"
        current={locale()}
        label={copy().chrome.language}
        options={[
          { label: copy().chrome.english, value: 'en' },
          { label: copy().chrome.japanese, value: 'ja' },
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
        labels={copy().chrome.theme}
        mode={theme()}
        onChange={(mode) => {
          saveThemeMode(mode)
          setTheme(mode)
        }}
      />
    </div>
  )

  const onClaim = (): void => {
    const sessionToken = token()
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
        const issuerId = session().operator?.issuer?.id
        let pending = issuerId === undefined ? undefined : (readPendingEnsClaim(issuerId) ?? undefined)
        const claim = claimState()
        if (claim.kind === 'failed' && claim.txHash !== undefined && claim.name !== undefined) {
          pending = { name: claim.name, txHash: claim.txHash }
        }
        const result = await runClaim(operatorIo.claim(sessionToken), guardedEmit, pending, (next) => {
          if (generation.isCurrent(ticket) && token() === sessionToken && issuerId !== undefined) {
            writePendingEnsClaim(issuerId, next)
          }
        })
        if (result.kind === 'claimed' && generation.isCurrent(ticket)) {
          const current = session().operator
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
  }

  // The venue's ENS claim. `ens` is null until /issuers/me says this deployment
  // has a parent name, and the section is left out entirely in that case rather
  // than offering a button that could only fail.
  const ensName = (): string | null => session().operator?.ens?.name ?? null
  const ensOwner = (): string | null => session().operator?.issuer?.operatorAddress ?? null
  const ensShown = (): boolean => ensName() !== null && ensOwner() !== null && token() !== null
  const ensSection = (
    <Show when={ensShown()}>
      <EnsClaim
        copy={copy().ens}
        name={ensName() ?? ''}
        ownerAddress={ensOwner() ?? ''}
        onClaim={onClaim}
        state={claimState()}
      />
    </Show>
  )

  const onPasskey = (): void => {
    invalidate()
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
    const oldToken = token() ?? restoringToken
    const hadOperator = session().operator !== null || restoringToken !== null
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

  const checkName = async (
    check: (sessionToken: string) => Promise<Result<{ available: boolean }>>,
  ): Promise<'available' | 'taken' | 'unknown'> => {
    const sessionToken = token()
    if (sessionToken === null) {
      return 'unknown'
    }
    const ticket = generation.capture()
    let result: Result<{ available: boolean }>
    try {
      result = await check(sessionToken)
    } catch {
      return 'unknown'
    }
    if (!generation.isCurrent(ticket) || token() !== sessionToken) {
      return 'unknown'
    }
    if (!result.ok) {
      if (result.status === 401) {
        replaceSession(unauthorizedSession(session()))
      }
      return 'unknown'
    }
    return result.body.available ? 'available' : 'taken'
  }
  const onCheckHandle = async (handle: string): Promise<'available' | 'taken' | 'unknown'> =>
    await checkName(async (sessionToken) => await operatorIo.checkHandle(sessionToken, handle))
  const onCheckSlug = async (slug: string): Promise<'available' | 'taken' | 'unknown'> =>
    await checkName(async (sessionToken) => await operatorIo.checkSlug(sessionToken, slug))

  const runCreate = <T,>(
    submit: () => Promise<{ ok: true; body: T } | { ok: false; failure: CreateFailure }>,
    apply: (body: T) => IssuerMeResponse,
    target: DashRoute,
  ): void => {
    const sessionToken = token()
    if (sessionToken === null) {
      setCreateFailure('input')
      return
    }
    const ticket = generation.capture()
    setCreateFailure(null)
    setCreating(true)
    const run = async (): Promise<void> => {
      let outcome: Awaited<ReturnType<typeof submit>>
      try {
        outcome = await submit()
      } catch {
        if (!generation.isCurrent(ticket) || token() !== sessionToken) {
          return
        }
        setCreating(false)
        setCreateFailure('network')
        return
      }
      if (!generation.isCurrent(ticket) || token() !== sessionToken) {
        return
      }
      if (!outcome.ok && outcome.failure === 'session') {
        replaceSession(unauthorizedSession(session()))
        return
      }
      setCreating(false)
      if (!outcome.ok) {
        setCreateFailure(outcome.failure)
        return
      }
      updateOperator(apply(outcome.body))
      setCardDraft(null)
      navigateTo(history, target)
      setRoute(target)
    }
    void run()
  }

  const onCreate = (_mode: DesignerMode, form: DesignerForm): void => {
    runCreate(
      async (): Promise<CardCreateOutcome> => await submitCard(operatorIo.design, token() ?? '', form),
      (body) => operatorWithCard(session().operator, body),
      '/cards',
    )
  }

  const onCreateVenue = (form: VenueForm, logo: LogoSet | null): void => {
    runCreate(
      async (): Promise<VenueCreateOutcome> =>
        await submitVenue(operatorIo.design, token() ?? '', form, logo),
      operatorWithVenue,
      '/profile',
    )
  }

  // The published screen changes a live venue's mark, which is a staged upload
  // spent by the commit route rather than by a create body.
  const onCommitLogo = async (variants: LogoSet): Promise<boolean> => {
    const sessionToken = token()
    if (sessionToken === null) {
      return false
    }
    const ticket = generation.capture()
    let outcome: Awaited<ReturnType<typeof applyLogo>>
    try {
      outcome = await applyLogo(operatorIo.design, sessionToken, variants)
    } catch {
      return false
    }
    if (!generation.isCurrent(ticket) || token() !== sessionToken) {
      return false
    }
    if (!outcome.ok) {
      if (outcome.session) {
        replaceSession(unauthorizedSession(session()))
      }
      return false
    }
    // The commit answers the updated issuer, whose `logoUrl` names the new
    // version; storing it is what makes the screen show the new mark.
    const { issuer } = outcome
    const current = session().operator
    if (current !== null && current.issuer !== null) {
      updateOperator({ ...current, issuer: { ...current.issuer, logoUrl: issuer.logoUrl } })
    }
    return true
  }

  const onUpdateVenue = async (body: IssuerUpdateRequest): Promise<boolean> => {
    const sessionToken = token()
    if (sessionToken === null || (session().operator?.issuer ?? null) === null) {
      return false
    }
    const ticket = generation.capture()
    let result: Awaited<ReturnType<OperatorIo['updateIssuer']>>
    try {
      result = await operatorIo.updateIssuer(sessionToken, body)
    } catch {
      return false
    }
    if (!generation.isCurrent(ticket) || token() !== sessionToken) {
      return false
    }
    if (!result.ok) {
      if (result.status === 401) {
        replaceSession(unauthorizedSession(session()))
      }
      return false
    }
    const current = session().operator
    if (current === null || current.issuer === null || current.issuer.id !== result.body.issuer.id) {
      return false
    }
    const { brandColor, name, tagline } = result.body.issuer
    // A concurrent logo commit owns logoUrl; a profile response only owns these fields.
    updateOperator({ ...current, issuer: { ...current.issuer, brandColor, name, tagline } })
    return true
  }

  const onDefaultCard = async (slug: string | null): Promise<boolean> => {
    const sessionToken = token()
    if (sessionToken === null || (session().operator?.issuer ?? null) === null) {
      return false
    }
    const ticket = generation.capture()
    const save = Symbol('default-card')
    latestDefaultSave = save
    let result: Awaited<ReturnType<OperatorIo['updateDefaultCard']>>
    try {
      result = await operatorIo.updateDefaultCard(sessionToken, { slug })
    } catch {
      return false
    }
    if (!generation.isCurrent(ticket) || token() !== sessionToken) {
      return false
    }
    if (!result.ok) {
      if (result.status === 401) {
        replaceSession(unauthorizedSession(session()))
      }
      return false
    }
    if (latestDefaultSave !== save || result.body.issuer.defaultCardSlug === undefined) {
      return false
    }
    const current = session().operator
    if (current === null || current.issuer === null || current.issuer.id !== result.body.issuer.id) {
      return false
    }
    // This response owns only the default selection. Concurrent profile and
    // logo writes keep their fields from the freshest active issuer snapshot.
    updateOperator({
      ...current,
      issuer: { ...current.issuer, defaultCardSlug: result.body.issuer.defaultCardSlug },
    })
    return true
  }

  // Every operator read ends the session on its own 401, unless a newer session
  // has replaced the one that asked.
  const guarded = async <R extends { ok: boolean; status?: number }>(
    call: (sessionToken: string) => Promise<R>,
  ): Promise<R> => {
    const sessionToken = token() ?? ''
    const ticket = generation.capture()
    const result = await call(sessionToken)
    if (!result.ok && result.status === 401 && generation.isCurrent(ticket) && token() === sessionToken) {
      replaceSession(unauthorizedSession(session()))
    }
    return result
  }

  const saveCard = async (cardId: string, body: Parameters<OperatorIo['updateCard']>[2]) => {
    const sessionToken = token()
    const ticket = generation.capture()
    const save = Symbol(cardId)
    latestCardSave.set(cardId, save)
    const result = await operatorIo.updateCard(sessionToken ?? '', cardId, body)
    if (!generation.isCurrent(ticket) || token() !== sessionToken) {
      return result
    }
    if (!result.ok) {
      if (result.status === 401) {
        replaceSession(unauthorizedSession(session()))
      }
      return result
    }
    if (latestCardSave.get(cardId) !== save) {
      return result
    }
    const { operator } = session()
    if (operator !== null && operator.issuer !== null) {
      updateOperator({
        ...operator,
        cards: operator.cards.map((card) => (card.id === cardId ? result.body.card : card)),
      })
    }
    return result
  }

  const unauthorizedResult = { error: 'unauthorized', network: false, ok: false, status: 401 } as const

  return (
    <AppView
      appearance={appearance}
      authError={session().authError}
      cardDraft={cardDraft()}
      cardManagement={{
        load: async (cardId) => await guarded(async (t) => await operatorIo.readCard(t, cardId)),
        save: saveCard,
      }}
      loadPasses={async (query) => await guarded(async (t) => await operatorIo.listPasses(t, query))}
      copy={copy()}
      createFailure={createFailure()}
      creating={creating()}
      graphEndpoint={GRAPH_RIGHTS_ENDPOINT}
      members={session().members}
      onChangeCardDraft={(form) => {
        setCardDraft(form)
      }}
      onCheckHandle={onCheckHandle}
      onCheckSlug={onCheckSlug}
      onCommitLogo={onCommitLogo}
      onCreate={onCreate}
      onCreateVenue={onCreateVenue}
      onEditProfile={(form) => {
        setCardDraft(form)
        navigateTo(history, '/profile')
        setRoute('/profile')
      }}
      onDefaultCard={onDefaultCard}
      onUpdateVenue={onUpdateVenue}
      onIssue={async (body) => {
        const context = actionContext()
        return context === null ? unauthorizedResult : await issueAndReload(context, body)
      }}
      onNavigate={(nextRoute) => {
        if (nextRoute !== route()) {
          navigateTo(history, nextRoute)
          setRoute(nextRoute)
        }
      }}
      ens={ensShown() ? ensSection : null}
      onPasskey={onPasskey}
      onRestore={restoreSession}
      restoreState={restoreState()}
      onRevoke={async (uid) => {
        const context = actionContext()
        return context === null ? unauthorizedResult : await revokeAndReload(context, uid)
      }}
      onSignOut={onSignOut}
      onToken={(nextToken) => {
        replaceSession({ authError: null, members: { kind: 'idle' }, operator: null, token: nextToken })
      }}
      receiveAtReception={async (qr, requestId) =>
        await guarded(async (t) => await operatorIo.receiveAtReception(t, qr, requestId))
      }
      route={route()}
      session={session()}
      signInError={signInError()}
      signingIn={signingIn()}
      integrations={{
        load: async (cardId) => await guarded(async (t) => await operatorIo.readCardIntegrations(t, cardId)),
        save: async (cardId, value) =>
          await guarded(async (t) => await operatorIo.updateCardIntegrations(t, cardId, value)),
      }}
      stampSettings={{
        load: async (cardId) => await guarded(async (t) => await operatorIo.readStampSettings(t, cardId)),
        save: async (cardId, settings) =>
          await guarded(async (t) => await operatorIo.updateStampSettings(t, cardId, settings)),
      }}
    />
  )
}
