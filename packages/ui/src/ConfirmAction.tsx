/** @jsxImportSource hono/jsx/dom */
import { useId, useRef } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

export interface ConfirmActionProps {
  label: string
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  onConfirm: () => void
  class?: string
  disabled?: boolean
}

export const ConfirmAction = ({
  label,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  class: className = 'btn btn-ghost btn-sm self-start',
  disabled,
}: ConfirmActionProps): JSX.Element => {
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
        class={className}
        disabled={disabled}
        ref={opener}
        type="button"
        onClick={() => {
          dialog.current?.showModal()
          cancel.current?.focus()
        }}
      >
        {label}
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
            {title}
          </h2>
          <p id={descriptionId} class="mt-2">
            {description}
          </p>
          <div class="modal-action">
            <button ref={cancel} class="btn" type="button" onClick={close}>
              {cancelLabel}
            </button>
            <button
              class="btn btn-error"
              type="button"
              onClick={() => {
                if (dialog.current?.open !== true) {
                  return
                }
                close()
                onConfirm()
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
