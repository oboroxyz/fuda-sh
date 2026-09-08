/** @jsxImportSource hono/jsx/dom */
import { useId, useRef } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'

export const SignOutButton = ({
  copy,
  onSignOut,
}: {
  copy: DashCopy['auth']
  onSignOut: () => void
}): JSX.Element => {
  const titleId = useId()
  const descriptionId = useId()
  const dialog = useRef<HTMLDialogElement | null>(null)
  const cancel = useRef<HTMLButtonElement | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const close = (): void => {
    dialog.current?.close()
  }
  return (
    <>
      <button
        class="btn btn-ghost btn-sm self-start"
        ref={opener}
        type="button"
        onClick={() => {
          dialog.current?.showModal()
          cancel.current?.focus()
        }}
      >
        {copy.signOut}
      </button>
      <dialog
        class="modal"
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => {
          opener.current?.focus()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            close()
          }
        }}
      >
        <div class="modal-box">
          <h2 id={titleId} class="text-lg font-bold">
            {copy.signOutTitle}
          </h2>
          <p id={descriptionId} class="mt-2">
            {copy.signOutDescription}
          </p>
          <div class="modal-action">
            <button ref={cancel} class="btn" type="button" onClick={close}>
              {copy.cancelSignOut}
            </button>
            <button
              class="btn btn-error"
              type="button"
              onClick={() => {
                if (dialog.current?.open !== true) {
                  return
                }
                close()
                onSignOut()
              }}
            >
              {copy.signOut}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
