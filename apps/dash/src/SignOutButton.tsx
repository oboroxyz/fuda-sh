/** @jsxImportSource hono/jsx/dom */
import { ConfirmAction } from '@fuda/ui'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'

export const SignOutButton = ({
  copy,
  onSignOut,
}: {
  copy: DashCopy['auth']
  onSignOut: () => void
}): JSX.Element => (
  <ConfirmAction
    label={copy.signOut}
    title={copy.signOutTitle}
    description={copy.signOutDescription}
    cancelLabel={copy.cancelSignOut}
    confirmLabel={copy.signOut}
    onConfirm={onSignOut}
  />
)
