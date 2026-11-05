import '../src/styles.css'
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useRouter } from 'void-preact'

import { ownedIssuers, switchIssuer } from '../src/api.ts'
import { DashboardShell } from '../src/DashboardShell.tsx'
import { Appearance, useCopy, useDash, useNavigate, useRoute, useSignOut } from '../src/page-context.tsx'
import type { ProfileChoices } from '../src/ProfileMenu.tsx'
import { setSessionVersion } from '../src/session-request.ts'
import { SignOutButton } from '../src/SignOutButton.tsx'

// Every dashboard page sits in the shell of its surface; sign-in has none.
export default function Layout(props: { children?: ComponentChildren }): ComponentChildren {
  const shared = useDash()
  const copy = useCopy()
  const route = useRoute()
  const navigate = useNavigate()
  const signOut = useSignOut()
  const router = useRouter()
  // A state-preserving refresh must not carry an old form into a new cookie
  // session: the version this layout first rendered with is the only one its
  // pages may write under. A different one unmounts them and reloads, before any
  // of them can act on the new session.
  const renderedVersion = useRef(shared.sessionVersion)
  const sessionChanged = shared.sessionVersion !== renderedVersion.current
  useLayoutEffect(() => {
    if (sessionChanged) {
      window.location.reload()
    } else {
      setSessionVersion(shared.sessionVersion)
    }
  }, [sessionChanged, shared.sessionVersion])

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

  if (sessionChanged) {
    return null
  }
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
  const issuer = shared.operator?.issuer ?? null
  if (router.path === '/oauth/authorize' || shared.surface === null) {
    return props.children
  }
  if (shared.restoreFailed) {
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
  return (
    <DashboardShell
      profiles={profileChoices}
      appearance={<Appearance />}
      copy={copy}
      hasIssuer={issuer !== null}
      venue={issuer === null ? null : { name: issuer.name, publicUrl: shared.operator?.publicUrl ?? null }}
      onNavigate={navigate}
      onSignOut={shared.surface === 'operator' ? signOut : null}
      route={route}
      surface={shared.surface}
    >
      {switchFailed ? <p role="alert">{copy.auth.restoreFailed}</p> : null}
      {props.children}
    </DashboardShell>
  )
}
