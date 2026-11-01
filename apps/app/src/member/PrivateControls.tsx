import { pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { createSignal, createUniqueId, For, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { ENTRY_COPY } from './entry-copy.ts'

const paths = {
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  details: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  key: 'M8 14a5 5 0 1 1 4-8l9 0v4h-3v3h-4l-2-2',
  right: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h4',
  search: 'M16 16l5 5M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0',
  sign: 'm14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14zM13 21h8',
  stealth: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2',
}

type IconKind = keyof typeof paths
export const PrivateIcon = (props: { kind: IconKind }): JSX.Element => (
  <svg
    aria-hidden="true"
    class="size-5 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d={paths[props.kind]} />
  </svg>
)

export const PrivateAction = (props: {
  label: string
  kind: IconKind
  onClick: (button: HTMLButtonElement) => void
  disabled?: boolean
  busy?: boolean
}): JSX.Element => (
  <button
    type="button"
    class="btn btn-ghost btn-square size-11 shrink-0 p-0"
    aria-label={props.label}
    title={props.label}
    disabled={props.disabled}
    onClick={(event) => {
      props.onClick(event.currentTarget)
    }}
  >
    {props.busy === true ? (
      <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    ) : (
      <PrivateIcon kind={props.kind} />
    )}
    <span class="sr-only">{props.label}</span>
  </button>
)

export const PrivateCopy = (props: { value: string; locale: Locale }): JSX.Element => {
  const c = (): (typeof ENTRY_COPY)[Locale] => pick(ENTRY_COPY, props.locale)
  const [copied, setCopied] = createSignal<'done' | 'failed' | 'idle'>('idle')
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }
  return (
    <div class="relative size-11 shrink-0">
      <PrivateAction
        kind="copy"
        label={c().copy[copied()]}
        onClick={() => {
          void copy()
        }}
      />
      <span class="bg-base-100 absolute top-full right-0 z-10 w-max max-w-40 rounded text-xs" role="status">
        {copied() === 'idle' ? '' : c().copy[copied()]}
      </span>
    </div>
  )
}

// Opens modally on mount and, on unmount, returns focus to the control that
// opened it (or a live sibling when that control is now disabled).
export const PrivateDialog = (props: {
  title: string
  closeLabel: string
  onClose: () => void
  children: JSX.Element
  opener: HTMLElement | null
}): JSX.Element => {
  const titleId = createUniqueId()
  let dialog: HTMLDialogElement | undefined
  let closeButton: HTMLButtonElement | undefined
  onMount(() => {
    const node = dialog
    const { opener } = props
    node?.showModal()
    closeButton?.focus({ preventScroll: true })
    onCleanup(() => {
      node?.close()
      if (opener instanceof HTMLElement && opener.isConnected) {
        const target = opener.matches(':disabled')
          ? opener.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          : opener
        target?.focus({ preventScroll: true })
      }
    })
  })
  const close = (): void => {
    dialog?.close()
  }
  return (
    <dialog
      class="modal"
      ref={(el) => {
        dialog = el
      }}
      aria-labelledby={titleId}
      onClose={() => {
        props.onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close()
        }
      }}
    >
      <div class="modal-box max-w-md">
        <h2 id={titleId} class="text-lg font-bold">
          {props.title}
        </h2>
        {props.children}
        <div class="modal-action">
          <button
            ref={(el) => {
              closeButton = el
            }}
            type="button"
            class="btn"
            onClick={close}
          >
            {props.closeLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}

export const PrivateDetails = (props: {
  fields: { label: string; value: string }[]
  locale: Locale
}): JSX.Element => (
  <dl class="mt-5 flex flex-col gap-5">
    <For each={props.fields}>
      {(field) => (
        <div>
          <dt class="text-sm font-semibold">{field.label}</dt>
          <dd class="mt-1 flex items-start gap-2">
            <span class="min-w-0 grow font-mono text-xs leading-relaxed break-all select-text">
              {field.value}
            </span>
            <PrivateCopy value={field.value} locale={props.locale} />
          </dd>
        </div>
      )}
    </For>
  </dl>
)
