import type { JSX } from 'preact'
import { useId, useRef } from 'preact/hooks'

export interface ConfirmActionProps {
  label: string
  icon?: JSX.Element
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  onConfirm: () => void
  class?: string
  disabled?: boolean
}

export const ConfirmAction = (props: ConfirmActionProps): JSX.Element => {
  const titleId = useId()
  const descriptionId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const close = (): void => {
    dialog.current?.close()
  }
  return (
    <>
      <button
        class={props.class ?? 'btn btn-ghost btn-sm self-start'}
        disabled={props.disabled}
        ref={opener}
        type="button"
        onClick={() => {
          dialog.current?.showModal()
          cancel.current?.focus()
        }}
      >
        {props.icon}
        {props.label}
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
            {props.title}
          </h2>
          <p id={descriptionId} class="mt-2">
            {props.description}
          </p>
          <div class="modal-action">
            <button ref={cancel} class="btn" type="button" onClick={close}>
              {props.cancelLabel}
            </button>
            <button
              class="btn btn-error"
              type="button"
              onClick={() => {
                if (dialog.current?.open !== true) {
                  return
                }
                close()
                props.onConfirm()
              }}
            >
              {props.confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
