import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

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

interface Passkey {
  backedUp: boolean
  createdAt: number
  id: string
}

export interface PasskeySectionProps {
  copy: PasskeySectionCopy
  formatDate: (unix: number) => string
  io: {
    add: () => Promise<{ ok: true } | { ok: false; failure: PasskeyAddFailure }>
    list: () => Promise<Passkey[]>
    remove: (id: string) => Promise<boolean>
  }
}

// docs/specs/pass-types-and-flows.md#passkey-ceremonies. The list a member keeps in
// Settings and an operator on their profile: a second passkey is how either moves to
// a device their current passkey does not sync to.
export const PasskeySection = (props: PasskeySectionProps): JSX.Element => {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<PasskeyAddFailure | 'remove' | null>(null)
  const io = useRef(props.io)
  io.current = props.io
  // The ceremony starts in the click, so the guard must hold before the next render.
  const adding = useRef(false)
  const mounted = useRef(true)
  const loads = useRef(0)

  const load = async (): Promise<void> => {
    loads.current += 1
    const generation = loads.current
    try {
      const list = await io.current.list()
      if (mounted.current && generation === loads.current) {
        setPasskeys(list)
        setLoadFailed(false)
      }
    } catch {
      if (mounted.current && generation === loads.current) {
        setLoadFailed(true)
      }
    }
  }

  // The list needs the browser's session, so the server render shows it empty.
  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
    }
  }, [])

  const add = async (): Promise<void> => {
    if (adding.current) {
      return
    }
    adding.current = true
    setBusy(true)
    setFailure(null)
    let outcome: Awaited<ReturnType<PasskeySectionProps['io']['add']>>
    try {
      outcome = await io.current.add()
    } finally {
      adding.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
    if (!mounted.current) {
      return
    }
    if (outcome.ok) {
      await load()
    } else {
      setFailure(outcome.failure)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setFailure(null)
    const removed = await io.current.remove(id)
    if (!mounted.current) {
      return
    }
    if (removed) {
      await load()
    } else {
      setFailure('remove')
    }
  }

  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-semibold">{props.copy.title}</h2>
      <p class="text-sm text-[var(--fuda-muted)]">{props.copy.hint}</p>
      {loadFailed ? (
        <div class="alert alert-error">{props.copy.loadFailed}</div>
      ) : (
        <ul class="flex flex-col gap-2">
          {(passkeys ?? []).map((passkey, index) => (
            <li
              key={passkey.id}
              class="flex items-center gap-3 rounded-xl border border-[var(--fuda-border)] p-3"
            >
              <div class="flex grow flex-col">
                <span class="text-sm font-medium">
                  {props.copy.name.replace('{number}', String(index + 1))}
                </span>
                <span class="text-xs text-[var(--fuda-muted)]">
                  {props.copy.created.replace('{date}', props.formatDate(passkey.createdAt))}
                  {passkey.backedUp ? ` · ${props.copy.synced}` : ''}
                </span>
              </div>
              {(passkeys?.length ?? 0) > 1 ? (
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
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {failure === null ? null : <div class="alert alert-error">{props.copy.failures[failure]}</div>}
      <button
        class="btn btn-outline w-full"
        disabled={busy}
        type="button"
        onClick={() => {
          void add()
        }}
      >
        {busy ? props.copy.adding : props.copy.add}
      </button>
    </section>
  )
}
