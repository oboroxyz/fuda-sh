import { pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { PasskeysResponse, PasskeyView } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import { ConfirmAction } from '@fuda/ui-preact'
import type { JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'

import { API_BASE_URL } from '../config.ts'
import { useLoad } from '../use-load.ts'
import { MEMBER_COPY } from './copy.ts'
import type { AddWithSecret } from './sensitive.ts'

type Failure = Extract<AddWithSecret, { ok: false }>['failure']

const loadPasskeys = async (): Promise<PasskeyView[]> => {
  const result = await apiFetch<PasskeysResponse>(API_BASE_URL, '/auth/member/passkeys')
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
  const { data: passkeys, error: loadError, refetch } = useLoad(loadPasskeys)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [failure, setFailure] = useState<Failure | 'remove' | null>(null)
  const [addedWithoutCopy, setAddedWithoutCopy] = useState(false)
  const holders = (): number => passkeys?.filter((passkey) => passkey.holdsSecret).length ?? 0
  const removable = (passkey: PasskeyView): boolean =>
    (passkeys?.length ?? 0) > 1 && !(passkey.holdsSecret && holders() === 1)

  const add = async (): Promise<void> => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
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
      busyRef.current = false
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
      {loadError === undefined ? (
        <ul class="flex flex-col gap-2">
          {(passkeys ?? []).map((passkey, index) => (
            <li
              key={passkey.id}
              class="flex items-center gap-3 rounded-2xl border border-[var(--fuda-border)] p-3"
            >
              <div class="flex grow flex-col">
                <span class="text-sm font-medium">{copy().name.replace('{number}', String(index + 1))}</span>
                <span class="text-xs text-[var(--fuda-muted)]">
                  {copy().created.replace('{date}', dateOf(passkey.createdAt, props.locale))}
                  {passkey.backedUp ? ` · ${copy().synced}` : ''}
                </span>
                {holders() > 0 ? (
                  <span class="text-xs text-[var(--fuda-muted)]">
                    {passkey.holdsSecret ? copy().opensSensitive : copy().cannotOpenSensitive}
                  </span>
                ) : null}
              </div>
              {removable(passkey) ? (
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
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div class="alert alert-error">{copy().loadFailed}</div>
      )}
      {failure ? <div class="alert alert-error">{copy().failures[failure]}</div> : null}
      {addedWithoutCopy ? <div class="alert alert-warning">{copy().addedWithoutCopy}</div> : null}
      {holders() > 0 ? <p class="text-sm text-[var(--fuda-muted)]">{copy().addKeepsSecret}</p> : null}
      <button
        class="btn btn-outline w-full"
        disabled={busy}
        type="button"
        onClick={() => {
          void add()
        }}
      >
        {busy ? copy().adding : copy().add}
      </button>
    </section>
  )
}
