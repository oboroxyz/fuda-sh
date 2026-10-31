/** @jsxImportSource solid-js */
import { createUniqueId } from 'solid-js'
import type { JSX } from 'solid-js'

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
  const titleId = createUniqueId()
  const descriptionId = createUniqueId()
  let dialog: HTMLDialogElement | undefined
  let cancel: HTMLButtonElement | undefined
  let opener: HTMLButtonElement | undefined
  const close = (): void => {
    dialog?.close()
  }
  return (
    <>
      <button
        class={props.class ?? 'btn btn-ghost btn-sm self-start'}
        disabled={props.disabled}
        ref={(el) => {
          opener = el
        }}
        type="button"
        onClick={() => {
          dialog?.showModal()
          cancel?.focus()
        }}
      >
        {props.icon}
        {props.label}
      </button>
      <dialog
        class="modal"
        ref={(el) => {
          dialog = el
        }}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => {
          opener?.focus()
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
            <button
              ref={(el) => {
                cancel = el
              }}
              class="btn"
              type="button"
              onClick={close}
            >
              {props.cancelLabel}
            </button>
            <button
              class="btn btn-error"
              type="button"
              onClick={() => {
                if (dialog?.open !== true) {
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
