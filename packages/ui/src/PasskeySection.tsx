import { createResource, createSignal, For, onMount, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { ConfirmAction } from './ConfirmAction.tsx'

type PasskeyAddFailure = 'cancelled' | 'limit' | 'network' | 'rejected' | 'unavailable'

export interface PasskeySectionCopy {
  add: string
  adding: string
  cancel: string
  created: string
  failures: Record<PasskeyAddFailure | 'remove', string>
  hint: string
  loadFailed: string
  name: string
  remove: string
  removeTitle: string
  removeWarning: string
  synced: string
  title: string
}

export interface PasskeySectionProps {
  copy: PasskeySectionCopy
  formatDate: (unix: number) => string
  io: {
    add: () => Promise<{ ok: true } | { ok: false; failure: PasskeyAddFailure }>
    list: () => Promise<{ backedUp: boolean; createdAt: number; id: string }[]>
    remove: (id: string) => Promise<boolean>
  }
}

// docs/specs/pass-types-and-flows.md#passkey-ceremonies. The list a member keeps in
// Settings and an operator on their profile: a second passkey is how either moves to
// a device their current passkey does not sync to.
export const PasskeySection = (props: PasskeySectionProps): JSX.Element => {
  // The list needs the browser's session, so a server render shows it empty.
  const [mounted, setMounted] = createSignal(false)
  onMount(() => {
    setMounted(true)
  })
  const [passkeys, { refetch }] = createResource(mounted, async () => await props.io.list())
  const [busy, setBusy] = createSignal(false)
  const [failure, setFailure] = createSignal<PasskeyAddFailure | 'remove' | null>(null)

  const add = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const outcome = await props.io.add()
    setBusy(false)
    if (outcome.ok) {
      await refetch()
    } else {
      setFailure(outcome.failure)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setFailure(null)
    if (await props.io.remove(id)) {
      await refetch()
    } else {
      setFailure('remove')
    }
  }

  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-semibold">{props.copy.title}</h2>
      <p class="text-sm text-[var(--fuda-muted)]">{props.copy.hint}</p>
      <Show
        when={passkeys.error === undefined}
        fallback={<div class="alert alert-error">{props.copy.loadFailed}</div>}
      >
        <ul class="flex flex-col gap-2">
          <For each={passkeys()}>
            {(passkey, index) => (
              <li class="flex items-center gap-3 rounded-xl border border-[var(--fuda-border)] p-3">
                <div class="flex grow flex-col">
                  <span class="text-sm font-medium">
                    {props.copy.name.replace('{number}', String(index() + 1))}
                  </span>
                  <span class="text-xs text-[var(--fuda-muted)]">
                    {props.copy.created.replace('{date}', props.formatDate(passkey.createdAt))}
                    {passkey.backedUp ? ` · ${props.copy.synced}` : ''}
                  </span>
                </div>
                <Show when={(passkeys()?.length ?? 0) > 1}>
                  <ConfirmAction
                    cancelLabel={props.copy.cancel}
                    confirmLabel={props.copy.remove}
                    description={props.copy.removeWarning}
                    label={props.copy.remove}
                    onConfirm={() => {
                      void remove(passkey.id)
                    }}
                    title={props.copy.removeTitle}
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={failure()}>
        {(current) => <div class="alert alert-error">{props.copy.failures[current()]}</div>}
      </Show>
      <button
        class="btn btn-outline w-full"
        disabled={busy()}
        type="button"
        onClick={() => {
          void add()
        }}
      >
        {busy() ? props.copy.adding : props.copy.add}
      </button>
    </section>
  )
}
