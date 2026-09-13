/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { useEffect, useId, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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
export const PrivateIcon = ({ kind }: { kind: IconKind }): JSX.Element => (
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
    <path d={paths[kind]} />
  </svg>
)

export const PrivateAction = ({
  label,
  kind,
  onClick,
  disabled,
  busy = false,
}: {
  label: string
  kind: IconKind
  onClick: (button: HTMLButtonElement) => void
  disabled?: boolean
  busy?: boolean
}): JSX.Element => (
  <button
    type="button"
    class="btn btn-ghost btn-square size-11 shrink-0 p-0"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={(event) => {
      if (event.currentTarget instanceof HTMLButtonElement) {
        onClick(event.currentTarget)
      }
    }}
  >
    {busy ? (
      <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    ) : (
      <PrivateIcon kind={kind} />
    )}
    <span class="sr-only">{label}</span>
  </button>
)

export const PrivateCopy = ({ value, locale }: { value: string; locale: Locale }): JSX.Element => {
  const c = pick(ENTRY_COPY, locale)
  const [copied, setCopied] = useState<'done' | 'failed' | 'idle'>('idle')
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }
  return (
    <div class="relative size-11 shrink-0">
      <PrivateAction
        kind="copy"
        label={c.copy[copied]}
        onClick={() => {
          void copy()
        }}
      />
      <span class="bg-base-100 absolute top-full right-0 z-10 w-max max-w-40 rounded text-xs" role="status">
        {copied === 'idle' ? '' : c.copy[copied]}
      </span>
    </div>
  )
}

export const PrivateDialog = ({
  title,
  closeLabel,
  onClose,
  children,
  opener,
}: {
  title: string
  closeLabel: string
  onClose: () => void
  children: JSX.Element
  opener: HTMLElement | null
}): JSX.Element => {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      node?.close()
      if (opener instanceof HTMLElement && opener.isConnected) {
        const target = opener.matches(':disabled')
          ? opener.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          : opener
        target?.focus({ preventScroll: true })
      }
    }
  }, [opener])
  const close = (): void => {
    dialog.current?.close()
  }
  return (
    <dialog
      class="modal"
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close()
        }
      }}
    >
      <div class="modal-box max-w-md">
        <h2 id={titleId} class="text-lg font-bold">
          {title}
        </h2>
        {children}
        <div class="modal-action">
          <button ref={closeButton} type="button" class="btn" onClick={close}>
            {closeLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}

export const PrivateDetails = ({
  fields,
  locale,
}: {
  fields: { label: string; value: string }[]
  locale: Locale
}): JSX.Element => (
  <dl class="mt-5 flex flex-col gap-5">
    {fields.map(({ label, value }): JSX.Element => (
      <div key={label}>
        <dt class="text-sm font-semibold">{label}</dt>
        <dd class="mt-1 flex items-start gap-2">
          <span class="min-w-0 grow font-mono text-xs leading-relaxed break-all select-text">{value}</span>
          <PrivateCopy value={value} locale={locale} />
        </dd>
      </div>
    ))}
  </dl>
)
