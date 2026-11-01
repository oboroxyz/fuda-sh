import '../src/styles.css'
import { useRouter } from '@void/solid'
import { createRenderEffect, createResource, createSignal, Match, Switch, untrack } from 'solid-js'
import type { JSX } from 'solid-js'
import { isServer } from 'solid-js/web'

import { ownedIssuers, switchIssuer } from '../src/api.ts'
import { DashboardShell } from '../src/DashboardShell.tsx'
import { Appearance, useCopy, useDash, useNavigate, useRoute, useSignOut } from '../src/page-context.tsx'
import { setSessionVersion } from '../src/session-request.ts'
import { SignOutButton } from '../src/SignOutButton.tsx'

// Every dashboard page sits in the shell of its surface; sign-in has none.
export default function Layout(props: { children?: JSX.Element }): JSX.Element {
  const shared = useDash()
  const copy = useCopy()
  const route = useRoute()
  const navigate = useNavigate()
  const signOut = useSignOut()
  const router = useRouter()
  // A state-preserving refresh must not carry an old form into a new cookie session.
  const renderedVersion = untrack(() => shared.sessionVersion)
  createRenderEffect(() => {
    if (!isServer) {
      if (shared.sessionVersion !== renderedVersion) {
        window.location.reload()
        return
      }
      setSessionVersion(shared.sessionVersion)
    }
  })
  const [profiles] = createResource(
    () => !isServer && shared.surface === 'operator',
    async () => await ownedIssuers(),
  )
  const [switchFailed, setSwitchFailed] = createSignal(false)
  const profileChoices = () => {
    const result = profiles()
    return result?.ok === true
      ? {
          activeId: shared.operator?.issuer?.id ?? null,
          issuers: result.body.issuers,
          onAdd: () => {
            window.location.assign('/profiles/new')
          },
          onSwitch: (issuerId: string) => {
            const run = async (): Promise<void> => {
              setSwitchFailed(false)
              const outcome = await switchIssuer(issuerId)
              if (outcome.ok) {
                window.location.assign('/cards')
              } else {
                setSwitchFailed(true)
              }
            }
            void run()
          },
        }
      : null
  }
  const issuer = () => shared.operator?.issuer ?? null
  return (
    <Switch
      fallback={
        <DashboardShell
          profiles={profileChoices()}
          appearance={<Appearance />}
          copy={copy()}
          hasIssuer={issuer() !== null}
          venue={
            issuer() === null
              ? null
              : { name: issuer()?.name ?? '', publicUrl: shared.operator?.publicUrl ?? null }
          }
          onNavigate={navigate}
          onSignOut={shared.surface === 'operator' ? signOut : null}
          route={route()}
          surface={shared.surface ?? 'admin'}
        >
          {switchFailed() ? <p role="alert">{copy().auth.restoreFailed}</p> : null}
          {props.children}
        </DashboardShell>
      }
    >
      <Match when={router.path === '/oauth/authorize'}>{props.children}</Match>
      <Match when={shared.surface === null}>{props.children}</Match>
      <Match when={shared.restoreFailed}>
        <main class="dash-auth">
          <div class="flex justify-end">
            <Appearance />
          </div>
          <div class="card mx-auto mt-32 flex max-w-md flex-col gap-6 p-8 py-12">
            <p role="alert">{copy().auth.restoreFailed}</p>
            <button
              class="btn btn-primary"
              onClick={() => {
                void router.refresh()
              }}
              type="button"
            >
              {copy().auth.retry}
            </button>
            <SignOutButton copy={copy().auth} onSignOut={signOut} />
          </div>
        </main>
      </Match>
    </Switch>
  )
}
