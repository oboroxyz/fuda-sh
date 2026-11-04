import { pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { MemberPasskeysResponse, MemberPasskeyView } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import { ConfirmAction } from '@fuda/ui'
import { createResource, createSignal, For, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { API_BASE_URL } from '../config.ts'
import { MEMBER_COPY } from './copy.ts'
import type { AddWithSecret } from './sensitive.ts'

type Failure = Extract<AddWithSecret, { ok: false }>['failure']

const loadPasskeys = async (): Promise<MemberPasskeyView[]> => {
  const result = await apiFetch<MemberPasskeysResponse>(API_BASE_URL, '/auth/member/passkeys')
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.body.passkeys
}

const dateOf = (unix: number, locale: Locale): string =>
  new Date(unix * 1000).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US')

// docs/specs/pass-types-and-flows.md#member-sign-in. A second passkey is how a member moves
// to a phone their current passkey does not sync to.
export const PasskeySection = (props: { locale: Locale }): JSX.Element => {
  const copy = (): (typeof MEMBER_COPY)[Locale]['passkeys'] => pick(MEMBER_COPY, props.locale).passkeys
  const [passkeys, { refetch }] = createResource(loadPasskeys)
  const [busy, setBusy] = createSignal(false)
  const [failure, setFailure] = createSignal<Failure | 'remove' | null>(null)
  const [addedWithoutCopy, setAddedWithoutCopy] = createSignal(false)
  const holders = (): number => passkeys()?.filter((passkey) => passkey.holdsSecret).length ?? 0
  const removable = (passkey: MemberPasskeyView): boolean =>
    (passkeys()?.length ?? 0) > 1 && !(passkey.holdsSecret && holders() === 1)

  const add = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    setAddedWithoutCopy(false)
    const hadCopies = holders() > 0
    try {
      const { addPasskeyKeepingSecret, defaultSensitiveIo } = await import('./sensitive.ts')
      const outcome = await addPasskeyKeepingSecret(defaultSensitiveIo)
      if (outcome.ok) {
        setAddedWithoutCopy(hadCopies && !outcome.holdsSecret)
        await refetch()
      } else {
        setFailure(outcome.failure)
      }
    } catch {
      setFailure('unavailable')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setFailure(null)
    const result = await apiFetch(API_BASE_URL, `/auth/member/passkeys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (result.ok) {
      await refetch()
    } else {
      setFailure('remove')
    }
  }

  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-semibold">{copy().title}</h2>
      <p class="text-sm text-[var(--fuda-muted)]">{copy().hint}</p>
      <Show
        when={passkeys.error === undefined}
        fallback={<div class="alert alert-error">{copy().loadFailed}</div>}
      >
        <ul class="flex flex-col gap-2">
          <For each={passkeys()}>
            {(passkey, index) => (
              <li class="flex items-center gap-3 rounded-2xl border border-[var(--fuda-border)] p-3">
                <div class="flex grow flex-col">
                  <span class="text-sm font-medium">
                    {copy().name.replace('{number}', String(index() + 1))}
                  </span>
                  <span class="text-xs text-[var(--fuda-muted)]">
                    {copy().created.replace('{date}', dateOf(passkey.createdAt, props.locale))}
                    {passkey.backedUp ? ` · ${copy().synced}` : ''}
                  </span>
                  <Show when={holders() > 0}>
                    <span class="text-xs text-[var(--fuda-muted)]">
                      {passkey.holdsSecret ? copy().opensSensitive : copy().cannotOpenSensitive}
                    </span>
                  </Show>
                </div>
                <Show when={removable(passkey)}>
                  <ConfirmAction
                    cancelLabel={copy().cancel}
                    confirmLabel={copy().remove}
                    description={copy().removeWarning}
                    label={copy().remove}
                    onConfirm={() => {
                      void remove(passkey.id)
                    }}
                    title={copy().removeTitle}
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={failure()}>
        {(current) => <div class="alert alert-error">{copy().failures[current()]}</div>}
      </Show>
      <Show when={addedWithoutCopy()}>
        <div class="alert alert-warning">{copy().addedWithoutCopy}</div>
      </Show>
      <Show when={holders() > 0}>
        <p class="text-sm text-[var(--fuda-muted)]">{copy().addKeepsSecret}</p>
      </Show>
      <button
        class="btn btn-outline w-full"
        disabled={busy()}
        type="button"
        onClick={() => {
          void add()
        }}
      >
        {busy() ? copy().adding : copy().add}
      </button>
    </section>
  )
}
