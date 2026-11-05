import '../src/styles.css'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useRouter } from 'void-preact'

import { ownedIssuers, switchIssuer } from '../src/api.ts'
import { DashboardShell } from '../src/DashboardShell.tsx'
import { Appearance, useCopy, useDash, useNavigate, useRoute, useSignOut } from '../src/page-context.tsx'
import type { ProfileChoices } from '../src/ProfileMenu.tsx'
import type { DashShared } from '../src/server/session.ts'
import { setSessionVersion } from '../src/session-request.ts'
import { SignOutButton } from '../src/SignOutButton.tsx'

// A state-preserving refresh must not carry an old form into a new cookie session: the
// version this layout first rendered with is the only one its pages may write under. A
// different one unmounts them and reloads, before any of them can act on the new session.
const useSessionBoundary = (sessionVersion: string | null): boolean => {
  const renderedVersion = useRef(sessionVersion)
  const changed = sessionVersion !== renderedVersion.current
  useLayoutEffect(() => {
    if (changed) {
      window.location.reload()
    } else {
      setSessionVersion(sessionVersion)
    }
  }, [changed, sessionVersion])
  return changed
}

// The venues this operator owns, loaded in the browser once the layout knows the session is
// theirs, and the action that switches to one.
interface ProfileChoiceState {
  profileChoices: ProfileChoices | null
  switchFailed: boolean
}

const useProfileChoices = (shared: DashShared, sessionChanged: boolean): ProfileChoiceState => {
  const [profiles, setProfiles] = useState<Awaited<ReturnType<typeof ownedIssuers>> | null>(null)
  const [switchFailed, setSwitchFailed] = useState(false)
  const operator = shared.surface === 'operator'
  useEffect(() => {
    if (!operator || sessionChanged) {
      return
    }
    let live = true
    const load = async (): Promise<void> => {
      const result = await ownedIssuers()
      if (live) {
        setProfiles(result)
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [operator, sessionChanged])
  const switching = useRef(false)

  const profileChoices: ProfileChoices | null =
    profiles?.ok === true
      ? {
          activeId: shared.operator?.issuer?.id ?? null,
          issuers: profiles.body.issuers,
          onAdd: () => {
            window.location.assign('/profiles/new')
          },
          onSwitch: (issuerId: string) => {
            if (switching.current) {
              return
            }
            switching.current = true
            const run = async (): Promise<void> => {
              setSwitchFailed(false)
              const outcome = await switchIssuer(issuerId)
              if (outcome.ok) {
                window.location.assign('/cards')
              } else {
                switching.current = false
                setSwitchFailed(true)
              }
            }
            void run()
          },
        }
      : null
  return { profileChoices, switchFailed }
}

const RestoreFailed = (): JSX.Element => {
  const copy = useCopy()
  const router = useRouter()
  const signOut = useSignOut()
  return (
    <main class="dash-auth">
      <div class="flex justify-end">
        <Appearance />
      </div>
      <div class="card mx-auto mt-32 flex max-w-md flex-col gap-6 p-8 py-12">
        <p role="alert">{copy.auth.restoreFailed}</p>
        <button
          class="btn btn-primary"
          onClick={() => {
            void router.refresh()
          }}
          type="button"
        >
          {copy.auth.retry}
        </button>
        <SignOutButton copy={copy.auth} onSignOut={signOut} />
      </div>
    </main>
  )
}

const LayoutShell = (props: {
  children: ComponentChildren
  profileChoices: ProfileChoices | null
  shared: DashShared
  switchFailed: boolean
}): JSX.Element => {
  const { shared } = props
  const copy = useCopy()
  const route = useRoute()
  const navigate = useNavigate()
  const signOut = useSignOut()
  const issuer = shared.operator?.issuer ?? null
  return (
    <DashboardShell
      profiles={props.profileChoices}
      appearance={<Appearance />}
      copy={copy}
      hasIssuer={issuer !== null}
      venue={issuer === null ? null : { name: issuer.name, publicUrl: shared.operator?.publicUrl ?? null }}
      onNavigate={navigate}
      onSignOut={shared.surface === 'operator' ? signOut : null}
      route={route}
      surface={shared.surface ?? 'admin'}
    >
      {props.switchFailed ? <p role="alert">{copy.auth.restoreFailed}</p> : null}
      {props.children}
    </DashboardShell>
  )
}

// Every dashboard page sits in the shell of its surface; sign-in has none.
export default function Layout(props: { children?: ComponentChildren }): ComponentChildren {
  const shared = useDash()
  const router = useRouter()
  const sessionChanged = useSessionBoundary(shared.sessionVersion)
  const { profileChoices, switchFailed } = useProfileChoices(shared, sessionChanged)

  if (sessionChanged) {
    return null
  }
  if (router.path === '/oauth/authorize' || shared.surface === null) {
    return props.children
  }
  if (shared.restoreFailed) {
    return <RestoreFailed />
  }
  return (
    <LayoutShell profileChoices={profileChoices} shared={shared} switchFailed={switchFailed}>
      {props.children}
    </LayoutShell>
  )
}
