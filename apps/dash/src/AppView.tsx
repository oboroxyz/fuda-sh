/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { SessionState } from './app-state.ts'
import type { CreateFailure, DesignerForm, DesignerMode } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { CardStampSettingsPage } from './CardStampSettingsPage.tsx'
import type { CardStampSettingsPageProps } from './CardStampSettingsPage.tsx'
import { API_BASE_URL } from './config.ts'
import type { DashCopy } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import type { IssueFormProps } from './IssueForm.tsx'
import { IssueForm } from './IssueForm.tsx'
import type { LogoSet } from './logo.ts'
import type { MembersState } from './members-state.ts'
import type { SignInFailure } from './operator-sign-in.ts'
import { OverviewPage } from './OverviewPage.tsx'
import { PublishedCard } from './PublishedCard.tsx'
import { ReceptionPage } from './ReceptionPage.tsx'
import type { ReceptionPageProps } from './ReceptionPage.tsx'
import type { RightsPageProps } from './RightsPage.tsx'
import { RightsPage } from './RightsPage.tsx'
import { cardIdFromRoute, cardSettingsPath } from './router.ts'
import type { DashRoute } from './router.ts'
import { SignIn, signInErrorOf } from './SignIn.tsx'
import { SignOutButton } from './SignOutButton.tsx'
import type { VenueForm } from './venue.ts'
import { VenuePage } from './VenuePage.tsx'
import type { VenuePageProps } from './VenuePage.tsx'

export interface AppViewProps {
  appearance: JSX.Element
  authError: 'unauthorized' | null
  // The venue's ENS section, already rendered; null while this deployment has no
  // ENS parent configured, in which case the dashboard says nothing about names.
  ens: JSX.Element | null
  copy: DashCopy
  createFailure: CreateFailure | null
  creating: boolean
  graphEndpoint: string
  members: MembersState
  onCheckHandle: (handle: string) => Promise<'available' | 'taken' | 'unknown'>
  onCheckSlug: (slug: string) => Promise<'available' | 'taken' | 'unknown'>
  onCommitLogo: (variants: LogoSet) => Promise<boolean>
  onCreate: (mode: DesignerMode, form: DesignerForm, logo: LogoSet | null) => void
  onCreateVenue: (form: VenueForm, logo: LogoSet | null) => void
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
  stampSettings: CardStampSettingsPageProps['settings']
}

export const AppView = ({
  appearance,
  ens,
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
  onCreateVenue,
  onIssue,
  onNavigate,
  onPasskey,
  onRestore,
  restoreState,
  onRevoke,
  onSignOut,
  onToken,
  onUpdateVenue,
  receiveAtReception,
  route,
  session,
  signInError,
  signingIn,
  stampSettings,
}: AppViewProps): JSX.Element => {
  const signInMessage = (): string | null => {
    if (signInError !== null) {
      return signInErrorOf(copy.auth, signInError)
    }
    return authError === 'unauthorized' ? copy.auth.unauthorized : null
  }

  if (restoreState !== null) {
    return (
      <main class="dash-auth">
        <div class="flex justify-end">{appearance}</div>
        <div class="card bg-base-200 mx-auto mt-16 flex max-w-md flex-col gap-4 p-6">
          <p role={restoreState === 'loading' ? 'status' : 'alert'}>
            {restoreState === 'loading' ? copy.auth.restoring : copy.auth.restoreFailed}
          </p>
          {restoreState === 'failed' ? (
            <button class="btn btn-primary" onClick={onRestore} type="button">
              {copy.auth.retry}
            </button>
          ) : null}
          <SignOutButton copy={copy.auth} onSignOut={onSignOut} />
        </div>
      </main>
    )
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
      if (route === '/profile') {
        return (
          <VenuePage
            busy={creating}
            canCreateCard={operator.ens?.status === 'claimed'}
            copy={copy}
            ens={ens}
            failure={createFailure}
            publicUrl={operator.publicUrl}
            issuer={operator.issuer}
            onCheckHandle={onCheckHandle}
            onCommitLogo={onCommitLogo}
            onCreate={onCreateVenue}
            onUpdate={onUpdateVenue}
          />
        )
      }
      if (route === '/cards/new' && operator.issuer !== null && operator.ens?.status !== 'claimed') {
        return (
          <section class="dash-page flex max-w-3xl flex-col gap-6">
            <header class="space-y-2">
              <h1 class="text-3xl font-bold">{copy.ens.requiredTitle}</h1>
              <p class="text-moderate">
                {operator.ens === null ? copy.venue.ensUnavailable : copy.ens.requiredDescription}
              </p>
            </header>
            <a class="btn btn-primary self-start" href="/profile">
              {copy.published.manageVenue}
            </a>
          </section>
        )
      }
      const cardId = cardIdFromRoute(route)
      if (operator.issuer !== null && cardId !== null) {
        return (
          <CardStampSettingsPage
            card={operator.cards.find((card) => card.id === cardId) ?? null}
            copy={copy}
            onBack={() => {
              onNavigate('/cards')
            }}
            settings={stampSettings}
          />
        )
      }
      if (operator.issuer !== null && route === '/cards') {
        return (
          <PublishedCard
            canAddCard={operator.ens?.status === 'claimed'}
            cards={operator.cards}
            onSettings={(selectedId) => {
              onNavigate(cardSettingsPath(selectedId))
            }}
            copy={copy.published}
            issuer={operator.issuer}
            onAddCard={() => {
              onNavigate('/cards/new')
            }}
            onVenue={() => {
              onNavigate('/profile')
            }}
            publicUrl={operator.publicUrl}
          />
        )
      }
      if (operator.issuer !== null && route === '/reception') {
        return <ReceptionPage copy={copy.reception} receive={receiveAtReception} />
      }
      return operator.issuer === null ? (
        <VenuePage
          busy={creating}
          canCreateCard={false}
          copy={copy}
          ens={ens}
          failure={createFailure}
          issuer={null}
          publicUrl={operator.publicUrl}
          onCheckHandle={onCheckHandle}
          onCommitLogo={onCommitLogo}
          onCreate={onCreateVenue}
          onUpdate={onUpdateVenue}
        />
      ) : (
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
      venue={
        operator === null || operator.issuer === null
          ? null
          : { name: operator.issuer.name, publicUrl: operator.publicUrl }
      }
      onNavigate={onNavigate}
      onSignOut={operator === null ? null : onSignOut}
      route={route}
      surface={surface}
    >
      {page()}
    </DashboardShell>
  )
}
