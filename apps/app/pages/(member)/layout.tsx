import { pick } from '@fuda/i18n'
import type { JSX } from 'preact'
import { useRouter } from 'void-preact'

import { MEMBER_COPY } from '../../src/member/copy.ts'
import { MemberLayout } from '../../src/member/MemberLayout.tsx'
import type { MemberRoute } from '../../src/member/MemberLayout.tsx'
import { useApp, useNavigate, useSignOut } from '../../src/page-context.tsx'

const MEMBER_ROUTES: readonly MemberRoute[] = ['rights', 'settings', 'signed']

const memberRouteOf = (path: string): MemberRoute =>
  MEMBER_ROUTES.find((route) => path === `/${route}` || path === `/${route}/`) ?? 'rights'

// The member pages: the Worker has already checked the session, or could not.
export default function MemberPages(props: { children?: JSX.Element }): JSX.Element {
  const shared = useApp()
  const router = useRouter()
  const navigate = useNavigate()
  const signOut = useSignOut()
  const copy = () => pick(MEMBER_COPY, shared.locale)
  return shared.restoreFailed ? (
    <main class="member-auth-page">
      <section class="member-panel flex w-full flex-col gap-4" role="status">
        <h1 class="member-heading">{copy().auth.failed}</h1>
        <p class="text-sm text-[var(--fuda-muted)]">{copy().auth.preserved}</p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <button
            class="btn btn-primary"
            type="button"
            onClick={() => {
              void router.refresh()
            }}
          >
            {copy().common.retry}
          </button>
          <button class="btn btn-ghost" type="button" onClick={signOut}>
            {copy().auth.signOutLocal}
          </button>
        </div>
      </section>
    </main>
  ) : (
    <MemberLayout locale={shared.locale} navigate={navigate} route={memberRouteOf(router.path)}>
      {props.children}
    </MemberLayout>
  )
}
