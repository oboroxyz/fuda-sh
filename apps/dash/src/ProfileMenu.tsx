import { createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import type { DashCopy } from './copy.ts'
import { SignOutButton } from './SignOutButton.tsx'
import { VenueLinkIcon } from './VenueLinkIcon.tsx'

export const ProfileMenu = (props: {
  copy: DashCopy
  venue: { name: string; publicUrl: string | null }
  onSignOut: (() => void) | null
}): JSX.Element => {
  const [open, setOpen] = createSignal(false)
  const menuId = createUniqueId()
  let container: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined

  createEffect(() => {
    if (!open()) {
      return
    }
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && container?.contains(event.target) === false) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside)
    })
  })

  return (
    <div class="min-w-0 space-y-2 border-y border-[var(--fuda-border)] p-3">
      <div
        ref={(el) => {
          container = el
        }}
        class="dropdown relative block"
        onKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest('dialog') !== null) {
            return
          }
          if (event.key === 'Escape' && open()) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            trigger?.focus()
          }
        }}
        onFocusOut={(event) => {
          if (event.relatedTarget instanceof Node && container?.contains(event.relatedTarget) === false) {
            setOpen(false)
          }
        }}
      >
        <button
          ref={(el) => {
            trigger = el
          }}
          class="font-display flex h-auto min-h-11 w-full items-center justify-between gap-2 px-2 py-2 text-left"
          type="button"
          aria-expanded={open() ? 'true' : 'false'}
          aria-controls={menuId}
          onClick={() => {
            setOpen(!open())
          }}
        >
          <span class="min-w-0 flex-1 wrap-anywhere">{props.venue.name}</span>
          <svg
            aria-hidden="true"
            class="size-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              d={open() ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div
          id={menuId}
          hidden={!open()}
          class="absolute top-full right-0 left-0 z-40 mt-2 rounded-xl border border-[var(--fuda-border)] bg-[var(--fuda-surface)] p-1 shadow-lg"
        >
          <button
            class="dash-menu-item btn btn-ghost w-full !border-0 font-normal shadow-none"
            type="button"
            disabled
          >
            <svg
              aria-hidden="true"
              class="size-5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                d="M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {props.copy.chrome.switchProfile}
          </button>
          {props.onSignOut === null ? null : (
            <div class="mt-1 border-t border-[var(--fuda-border)] pt-1">
              <SignOutButton
                copy={props.copy.auth}
                onSignOut={() => {
                  props.onSignOut?.()
                }}
                menu
              />
            </div>
          )}
        </div>
      </div>
      {props.venue.publicUrl === null ? null : (
        <a
          class="link link-hover flex items-start gap-2 px-2 text-xs text-[var(--fuda-muted)]"
          href={props.venue.publicUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <VenueLinkIcon kind="globe" />
          <span class="min-w-0 wrap-anywhere">{props.venue.publicUrl}</span>
        </a>
      )}
    </div>
  )
}
