import '../src/styles.css'
import { useRouter } from '@void/solid'
import { Match, Switch } from 'solid-js'
import type { JSX } from 'solid-js'

import { DashboardShell } from '../src/DashboardShell.tsx'
import { Appearance, useCopy, useDash, useNavigate, useRoute, useSignOut } from '../src/page-context.tsx'
import { SignOutButton } from '../src/SignOutButton.tsx'

// Every dashboard page sits in the shell of its surface; sign-in has none.
export default function Layout(props: { children?: JSX.Element }): JSX.Element {
  const shared = useDash()
  const copy = useCopy()
  const route = useRoute()
  const navigate = useNavigate()
  const signOut = useSignOut()
  const router = useRouter()
  const issuer = () => shared.operator?.issuer ?? null
  return (
    <Switch
      fallback={
        <DashboardShell
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
          {props.children}
        </DashboardShell>
      }
    >
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
