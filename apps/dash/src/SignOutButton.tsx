import { ConfirmAction } from '@fuda/ui/solid'
import type { JSX } from 'solid-js'

import type { DashCopy } from './copy.ts'

export const SignOutButton = (props: {
  copy: DashCopy['auth']
  onSignOut: () => void
  menu?: boolean
}): JSX.Element => (
  <ConfirmAction
    class={
      props.menu === true
        ? 'dash-menu-item btn btn-ghost w-full !border-0 font-normal shadow-none'
        : undefined
    }
    icon={
      props.menu === true ? (
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
    label={props.copy.signOut}
    title={props.copy.signOutTitle}
    description={props.copy.signOutDescription}
    cancelLabel={props.copy.cancelSignOut}
    confirmLabel={props.copy.signOut}
    onConfirm={() => {
      props.onSignOut()
    }}
  />
)
