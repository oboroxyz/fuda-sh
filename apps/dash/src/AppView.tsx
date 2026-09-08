/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { SessionState } from './app-state.ts'
import type { CreateFailure, DesignerForm, DesignerMode } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
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
import type { RightsPageProps } from './RightsPage.tsx'
import { RightsPage } from './RightsPage.tsx'
import type { DashRoute } from './router.ts'
import { SignIn, signInErrorOf } from './SignIn.tsx'

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
  onIssue: IssueFormProps['onIssue']
  onNavigate: (route: DashRoute) => void
  onPasskey: () => void
  onRestore: () => void
  restoreState: 'loading' | 'failed' | null
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
  onIssue,
  onNavigate,
  onPasskey,
  onRestore,
  restoreState,
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
          <button class="btn" onClick={onSignOut} type="button">
            {copy.auth.signOut}
          </button>
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
      // `/new` stays open once the venue exists: it is how a second card is added.
      if (operator.issuer !== null && route !== '/new') {
        return (
          <PublishedCard
            cards={operator.cards}
            copy={copy.published}
            ens={ens}
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
