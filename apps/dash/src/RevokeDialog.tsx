/** @jsxImportSource hono/jsx/dom */
import { useEffect, useRef } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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

export const RevokeDialog = ({
  busy,
  copy,
  error,
  onCancel,
  onConfirm,
  target,
}: RevokeDialogProps): JSX.Element => {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) {
      return
    }
    if (target === null) {
      if (dialog.open) {
        dialog.close()
      }
    } else if (!dialog.open) {
      dialog.showModal()
      cancelRef.current?.focus()
    }
  }, [target])

  const cancel = (): void => {
    if (!busy) {
      onCancel()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      class="modal"
      aria-modal="true"
      aria-labelledby="revoke-title"
      aria-describedby="revoke-description"
      onCancel={(event: Event) => {
        event.preventDefault()
        cancel()
      }}
      onClose={() => {
        if (busy && target !== null) {
          dialogRef.current?.showModal()
        } else if (target !== null) {
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
          {copy.title}
        </h2>
        <p id="revoke-description" class="mt-2 text-sm opacity-70">
          {copy.description}
        </p>
        {target === null ? null : (
          <div class="bg-base-200 mt-4 flex flex-col gap-2 rounded-lg p-4">
            <p class="font-medium">{target.memberId || copy.memberFallback}</p>
            <p class="font-mono text-xs">{target.holderShort ?? '—'}</p>
            <span class="badge">{target.level}</span>
            <code class="text-xs" title={target.uid}>
              <span class="sr-only">{target.uid}</span>
              <span aria-hidden="true">{`${target.uid.slice(0, 10)}…`}</span>
            </code>
          </div>
        )}
        {error === null ? null : (
          <p role="alert" class="alert alert-error mt-4">{`${copy.errorPrefix}: ${error}`}</p>
        )}
        <p role="status" aria-live="polite" class="sr-only">
          {busy ? copy.revoking : ''}
        </p>
        <div class="modal-action">
          <button ref={cancelRef} type="button" class="btn" disabled={busy} onClick={cancel}>
            {copy.cancel}
          </button>
          <button
            type="button"
            class="btn btn-error"
            disabled={busy || target === null || target.status === 'revoked'}
            onClick={() => {
              if (!busy && target?.status === 'active') {
                onConfirm()
              }
            }}
          >
            {busy ? copy.revoking : copy.confirm}
          </button>
        </div>
      </div>
    </dialog>
  )
}
