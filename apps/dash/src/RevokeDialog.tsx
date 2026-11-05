import { createEffect } from 'solid-js'
import type { JSX } from 'solid-js'

import type { DashCopy } from './copy.ts'
import type { MemberRowView } from './members-view.ts'

export interface RevokeDialogProps {
  busy: boolean
  copy: DashCopy['revoke']
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  target: MemberRowView | null
}

export const RevokeDialog = (props: RevokeDialogProps): JSX.Element => {
  let dialog: HTMLDialogElement | undefined
  let cancelButton: HTMLButtonElement | undefined

  createEffect(() => {
    const { target } = props
    if (dialog === undefined) {
      return
    }
    if (target === null) {
      if (dialog.open) {
        dialog.close()
      }
    } else if (!dialog.open) {
      dialog.showModal()
      cancelButton?.focus()
    }
  })

  const cancel = (): void => {
    if (!props.busy) {
      props.onCancel()
    }
  }

  return (
    <dialog
      ref={(el) => {
        dialog = el
      }}
      class="modal"
      aria-modal="true"
      aria-labelledby="revoke-title"
      aria-describedby="revoke-description"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onClose={() => {
        if (props.busy && props.target !== null) {
          dialog?.showModal()
        } else if (props.target !== null) {
          cancel()
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          cancel()
        }
      }}
    >
      <div class="modal-box">
        <h2 id="revoke-title" class="text-lg font-bold">
          {props.copy.title}
        </h2>
        <p id="revoke-description" class="mt-2 text-sm opacity-70">
          {props.copy.description}
        </p>
        {props.target === null ? null : (
          <div class="bg-base-200 mt-4 flex flex-col gap-2 rounded-lg p-4">
            <p class="font-medium">{props.target.memberId || props.copy.memberFallback}</p>
            <p class="font-mono text-xs">{props.target.holderShort ?? '—'}</p>
            <span class="badge">{props.target.level}</span>
            <code class="text-xs" title={props.target.uid}>
              <span class="sr-only">{props.target.uid}</span>
              <span aria-hidden="true">{`${props.target.uid.slice(0, 10)}…`}</span>
            </code>
          </div>
        )}
        {props.error === null ? null : (
          <p
            role="alert"
            class="alert alert-error mt-4"
          >{`${props.copy.errorPrefix}: ${props.copy.errorMessage(props.error)}`}</p>
        )}
        <p role="status" aria-live="polite" class="sr-only">
          {props.busy ? props.copy.revoking : ''}
        </p>
        <div class="modal-action">
          <button
            ref={(el) => {
              cancelButton = el
            }}
            type="button"
            class="btn"
            disabled={props.busy}
            onClick={cancel}
          >
            {props.copy.cancel}
          </button>
          <button
            type="button"
            class="btn btn-error"
            disabled={props.busy || props.target === null || props.target.status === 'revoked'}
            onClick={() => {
              if (!props.busy && props.target?.status === 'active') {
                props.onConfirm()
              }
            }}
          >
            {props.busy ? props.copy.revoking : props.copy.confirm}
          </button>
        </div>
      </div>
    </dialog>
  )
}
