import type { IssuerMeResponse, IssuerView } from '@fuda/sdk'
import { createMemo, Match, Show, Switch } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'

import type { SessionState } from './app-state.ts'
import type { CreateFailure, DesignerForm, DesignerMode } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { CardDetailPage } from './CardDetailPage.tsx'
import { CardEditPage } from './CardEditPage.tsx'
import type { CardEditPageProps } from './CardEditPage.tsx'
import type { CardStampIo } from './CardStampSettings.tsx'
import { API_BASE_URL } from './config.ts'
import type { DashCopy } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import type { CardIntegrationsIo } from './IntegrationSettings.tsx'
import type { IssueFormProps } from './IssueForm.tsx'
import { IssueForm } from './IssueForm.tsx'
import type { PassesLoad } from './issuer-passes-state.ts'
import { IssuerPassesPage } from './IssuerPassesPage.tsx'
import type { LogoSet } from './logo.ts'
import type { MembersState } from './members-state.ts'
import type { SignInFailure } from './operator-sign-in.ts'
import { OverviewPage } from './OverviewPage.tsx'
import { PublishedCard } from './PublishedCard.tsx'
import { ReceptionPage } from './ReceptionPage.tsx'
import type { ReceptionPageProps } from './ReceptionPage.tsx'
import type { RightsPageProps } from './RightsPage.tsx'
import { RightsPage } from './RightsPage.tsx'
import {
  cardForRoute,
  cardEditPath,
  isCardEditRoute,
  isCardRoute,
  isLegacyCardSettingsRoute,
} from './router.ts'
import type { DashRoute } from './router.ts'
import { SignIn, signInErrorOf } from './SignIn.tsx'
import { SignOutButton } from './SignOutButton.tsx'
import type { VenueForm } from './venue.ts'
import { VenuePage } from './VenuePage.tsx'
import type { VenuePageProps } from './VenuePage.tsx'

export interface AppViewProps {
  appearance: JSX.Element
  authError: 'unauthorized' | null
  cardDraft: DesignerForm | null
  cardManagement: Pick<CardEditPageProps, 'load' | 'save'>
  loadPasses: PassesLoad
  // The venue's ENS section, already rendered; null while this deployment has no
  // ENS parent configured, in which case the dashboard says nothing about names.
  ens: JSX.Element | null
  copy: DashCopy
  createFailure: CreateFailure | null
  creating: boolean
  graphEndpoint: string
  integrations: CardIntegrationsIo
  members: MembersState
  onChangeCardDraft: (form: DesignerForm) => void
  onCheckHandle: (handle: string) => Promise<'available' | 'taken' | 'unknown'>
  onCheckSlug: (slug: string) => Promise<'available' | 'taken' | 'unknown'>
  onCommitLogo: (variants: LogoSet) => Promise<boolean>
  onCreate: (mode: DesignerMode, form: DesignerForm, logo: LogoSet | null) => void
  onCreateVenue: (form: VenueForm, logo: LogoSet | null) => void
  onDefaultCard: (slug: string | null) => Promise<boolean>
  onEditProfile: (form: DesignerForm) => void
  onIssue: IssueFormProps['onIssue']
  onNavigate: (route: DashRoute) => void
  onPasskey: () => void
  onRestore: () => void
  restoreState: 'loading' | 'failed' | null
  onRevoke: RightsPageProps['onRevoke']
  onSignOut: () => void
  onToken: (token: string) => void
  onUpdateVenue: VenuePageProps['onUpdate']
  receiveAtReception: ReceptionPageProps['receive']
  route: DashRoute
  session: SessionState
  signInError: SignInFailure | null
  signingIn: boolean
  stampSettings: CardStampIo
}

type PageKind =
  | 'venue'
  | 'edit'
  | 'detail'
  | 'passes'
  | 'cards'
  | 'reception'
  | 'designer'
  | 'rights'
  | 'issue'
  | 'overview'

// Which screen the route shows. A screen is rebuilt only when this kind, the
// session token or (for one Card) the route changes, so typing into a page is
// never thrown away by an unrelated session update.
const pageKindOf = (operator: IssuerMeResponse | null, route: DashRoute): PageKind => {
  if (operator === null) {
    if (route === '/rights') {
      return 'rights'
    }
    return route === '/issue' ? 'issue' : 'overview'
  }
  if (route === '/profile' || operator.issuer === null) {
    return 'venue'
  }
  if (isCardEditRoute(route) || isLegacyCardSettingsRoute(route)) {
    return 'edit'
  }
  if (isCardRoute(route)) {
    return 'detail'
  }
  if (route === '/passes') {
    return 'passes'
  }
  if (route === '/cards') {
    return 'cards'
  }
  return route === '/reception' ? 'reception' : 'designer'
}

const pageIdentity = (kind: PageKind, token: string | null, route: DashRoute): string => {
  if (kind === 'edit' || kind === 'detail') {
    return `${kind}:${token ?? ''}:${route}`
  }
  if (kind === 'passes' || kind === 'cards' || kind === 'reception') {
    return `${kind}:${token ?? ''}`
  }
  return kind
}

export const AppView = (props: AppViewProps): JSX.Element => {
  const signInMessage = (): string | null => {
    if (props.signInError !== null) {
      return signInErrorOf(props.copy.auth, props.signInError)
    }
    return props.authError === 'unauthorized' ? props.copy.auth.unauthorized : null
  }
  const operator = (): IssuerMeResponse | null => props.session.operator
  const issuer = (): IssuerView | null => operator()?.issuer ?? null
  const cards = (): IssuerMeResponse['cards'] => operator()?.cards ?? []
  const publicUrl = (): string => operator()?.publicUrl ?? ''
  const kind = createMemo(() => pageKindOf(operator(), props.route))
  const identity = createMemo(() => pageIdentity(kind(), props.session.token, props.route))

  // Pages that need the venue get it as a live accessor; they are only built
  // while the operator has one.
  const withIssuer = (render: (current: Accessor<IssuerView>) => JSX.Element): JSX.Element => (
    <Show when={issuer()}>{(current) => render(current)}</Show>
  )

  const pages = {
    cards: () =>
      withIssuer((current) => (
        <PublishedCard
          cards={cards()}
          onSettings={(selectedId) => {
            const selected = cards().find((card) => card.id === selectedId)
            if (selected !== undefined) {
              props.onNavigate(cardEditPath(selected))
            }
          }}
          onDefaultCard={props.onDefaultCard}
          copy={props.copy.published}
          managementCopy={props.copy.management}
          loadPasses={props.loadPasses}
          onNavigate={props.onNavigate}
          issuer={current()}
          onAddCard={() => {
            props.onNavigate('/cards/new')
          }}
          publicUrl={publicUrl()}
        />
      )),
    designer: () => (
      <CardDesigner
        busy={props.creating}
        copy={props.copy.designer}
        failure={props.createFailure}
        initialDraft={props.cardDraft}
        issuer={issuer()}
        logoCopy={props.copy.logo}
        onCheckHandle={props.onCheckHandle}
        onCheckSlug={props.onCheckSlug}
        onDraftChange={props.onChangeCardDraft}
        onEditProfile={props.onEditProfile}
        onSubmit={props.onCreate}
      />
    ),
    detail: () => (
      <CardDetailPage
        card={cardForRoute(props.route, cards())}
        copy={props.copy}
        publicUrl={publicUrl()}
        onNavigate={props.onNavigate}
      />
    ),
    edit: () =>
      withIssuer((current) => (
        <CardEditPage
          card={cardForRoute(props.route, cards())}
          copy={props.copy}
          issuer={current()}
          load={props.cardManagement.load}
          save={props.cardManagement.save}
          integrations={props.integrations}
          onNavigate={props.onNavigate}
          settings={props.stampSettings}
        />
      )),
    issue: () => <IssueForm copy={props.copy.issue} onIssue={props.onIssue} />,
    overview: () => (
      <OverviewPage
        apiBaseUrl={API_BASE_URL}
        copy={props.copy.overview}
        graphEndpoint={props.graphEndpoint}
        state={props.members}
      />
    ),
    passes: () => <IssuerPassesPage cards={cards()} copy={props.copy.management} load={props.loadPasses} />,
    reception: () => <ReceptionPage copy={props.copy.reception} receive={props.receiveAtReception} />,
    rights: () => (
      <RightsPage
        copy={props.copy}
        graphEndpoint={props.graphEndpoint}
        members={props.members}
        onRevoke={props.onRevoke}
      />
    ),
    venue: () => (
      <VenuePage
        busy={props.creating}
        copy={props.copy}
        ens={props.ens}
        failure={props.createFailure}
        publicUrl={operator()?.publicUrl ?? null}
        issuer={issuer()}
        onCheckHandle={props.onCheckHandle}
        onCommitLogo={props.onCommitLogo}
        onCreate={props.onCreateVenue}
        hasCardDraft={props.cardDraft !== null}
        onNavigate={props.onNavigate}
        onUpdate={props.onUpdateVenue}
      />
    ),
  } satisfies Record<PageKind, () => JSX.Element>

  return (
    <Switch
      fallback={
        <DashboardShell
          appearance={props.appearance}
          copy={props.copy}
          hasIssuer={issuer() !== null}
          venue={
            issuer() === null
              ? null
              : { name: issuer()?.name ?? '', publicUrl: operator()?.publicUrl ?? null }
          }
          onNavigate={props.onNavigate}
          onSignOut={operator() === null ? null : props.onSignOut}
          route={props.route}
          surface={operator() === null ? 'admin' : 'operator'}
        >
          <Show when={identity()} keyed>
            {(_identity: string) => pages[kind()]()}
          </Show>
        </DashboardShell>
      }
    >
      <Match when={props.restoreState !== null}>
        <main class="dash-auth">
          <div class="flex justify-end">{props.appearance}</div>
          <div class="card mx-auto mt-32 flex max-w-md flex-col gap-6 p-8 py-12">
            <p role={props.restoreState === 'loading' ? 'status' : 'alert'}>
              {props.restoreState === 'loading' ? props.copy.auth.restoring : props.copy.auth.restoreFailed}
            </p>
            {props.restoreState === 'failed' ? (
              <button
                class="btn btn-primary"
                onClick={() => {
                  props.onRestore()
                }}
                type="button"
              >
                {props.copy.auth.retry}
              </button>
            ) : null}
            <SignOutButton copy={props.copy.auth} onSignOut={props.onSignOut} />
          </div>
        </main>
      </Match>
      <Match when={props.session.token === null}>
        <SignIn
          appearance={props.appearance}
          copy={props.copy.auth}
          error={signInMessage()}
          onPasskey={props.onPasskey}
          onToken={props.onToken}
          pending={props.signingIn}
        />
      </Match>
    </Switch>
  )
}
