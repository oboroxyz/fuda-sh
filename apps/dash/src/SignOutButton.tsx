/** @jsxImportSource hono/jsx/dom */
import { ConfirmAction } from '@fuda/ui'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'

export const SignOutButton = ({
  copy,
  onSignOut,
  menu = false,
}: {
  copy: DashCopy['auth']
  onSignOut: () => void
  menu?: boolean
}): JSX.Element => (
  <ConfirmAction
    class={menu ? 'dash-menu-item btn btn-ghost w-full !border-0 font-normal shadow-none' : undefined}
    icon={
      menu ? (
        <svg
          aria-hidden="true"
          class="size-5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M9 4H4v16h5 M9 12h12 M16 7l5 5-5 5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      ) : undefined
    }
    label={copy.signOut}
    title={copy.signOutTitle}
    description={copy.signOutDescription}
    cancelLabel={copy.cancelSignOut}
    confirmLabel={copy.signOut}
    onConfirm={onSignOut}
  />
)
