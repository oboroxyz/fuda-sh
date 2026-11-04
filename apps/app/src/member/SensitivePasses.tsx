import { pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { MemberSecretResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import { ConfirmAction } from '@fuda/ui'
import { createResource, createSignal, For, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { challenge, verifySigned } from '../api.ts'
import { API_BASE_URL } from '../config.ts'
import { displayOf, enterSigned } from '../signed-gate.ts'
import type { SignedDisplay } from '../signed-gate.ts'
import { MEMBER_COPY } from './copy.ts'
import type { VaultEntry } from './member-secret.ts'
import { Verdict } from './Verdict.tsx'

const holdsSecret = async (): Promise<boolean> => {
  const state = await apiFetch<MemberSecretResponse>(API_BASE_URL, '/member/secret')
  return state.ok && state.body.copies.length > 0
}

interface Opened {
  entries: VaultEntry[]
  secret: Uint8Array<ArrayBuffer>
}

type Problem = 'failed' | 'notOpened'

const readList = async (): Promise<{ list: Opened } | { problem: Problem }> => {
  const { defaultSensitiveIo, openMemberSecret, readVaultEntries } = await import('./sensitive.ts')
  const secret = await openMemberSecret(defaultSensitiveIo)
  if (secret.kind !== 'open') {
    return { problem: secret.kind === 'failed' ? 'failed' : 'notOpened' }
  }
  const read = await readVaultEntries(defaultSensitiveIo, secret.secret)
  return read.ok ? { list: { entries: read.entries, secret: secret.secret } } : { problem: 'failed' }
}

// docs/specs/pass-types-and-flows.md#sensitive-use. The account has no list of these passes
// the server can read, so this asks for a passkey only when the member asks to see them, and
// asks the server nothing about any one of them until the member enters with it. The opened
// secret lives only in this screen, so entering from here takes no second prompt.
export const SensitivePasses = (props: { locale: Locale }): JSX.Element => {
  const copy = (): (typeof MEMBER_COPY)[Locale]['sensitive'] => pick(MEMBER_COPY, props.locale).sensitive
  const [held, { refetch }] = createResource(holdsSecret)
  const [startedOver, setStartedOver] = createSignal<boolean | null>(null)
  const [opened, setOpened] = createSignal<Opened | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [problem, setProblem] = createSignal<Problem | null>(null)
  const [verdict, setVerdict] = createSignal<SignedDisplay | null>(null)

  const openList = async (): Promise<void> => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await readList()
      if ('list' in result) {
        setOpened(result.list)
      } else {
        setProblem(result.problem)
      }
    } catch {
      setProblem('failed')
    } finally {
      setBusy(false)
    }
  }

  const startOver = async (): Promise<void> => {
    setBusy(true)
    const { startSecretOver } = await import('./sensitive.ts')
    const cleared = await startSecretOver()
    setBusy(false)
    setStartedOver(cleared)
    if (cleared) {
      setProblem(null)
      await refetch()
    }
  }

  const enter = async (entry: VaultEntry, secret: Opened['secret']): Promise<void> => {
    setBusy(true)
    setProblem(null)
    try {
      const { passKeyFrom } = await import('./member-secret.ts')
      const key = await passKeyFrom(secret, entry.salt)
      const outcome = await enterSigned(
        {
          challenge,
          sign: async (message) => await key.signMessage({ message }),
          verify: verifySigned,
        },
        entry.uid,
      )
      setVerdict(displayOf(outcome))
    } catch {
      setProblem('failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Show when={startedOver() === true}>
        <p role="status" class="alert alert-info text-sm">
          {copy().startOverDone}
        </p>
      </Show>
      <Show when={held() === true}>
        <section class="flex flex-col gap-3" data-testid="sensitive-passes">
          <h2 class="text-sm font-semibold">{copy().title}</h2>
          <Show
            when={opened()}
            fallback={
              <>
                <p class="text-sm text-[var(--fuda-muted)]">{copy().hint}</p>
                <button
                  class="btn btn-outline w-full"
                  disabled={busy()}
                  type="button"
                  onClick={() => {
                    void openList()
                  }}
                >
                  {busy() ? copy().opening : copy().open}
                </button>
              </>
            }
          >
            {(list) => (
              <Show
                when={list().entries.length > 0}
                fallback={<p class="text-sm text-[var(--fuda-muted)]">{copy().empty}</p>}
              >
                <ul class="flex flex-col gap-2">
                  <For each={list().entries}>
                    {(entry) => (
                      <li class="flex items-center gap-3 rounded-2xl border border-[var(--fuda-border)] p-3">
                        <div class="flex min-w-0 grow flex-col">
                          <span class="text-sm font-medium wrap-anywhere">{entry.cardTitle}</span>
                          <span class="text-xs wrap-anywhere text-[var(--fuda-muted)]">@{entry.venue}</span>
                        </div>
                        <button
                          class="btn btn-primary btn-sm"
                          disabled={busy()}
                          type="button"
                          onClick={() => {
                            void enter(entry, list().secret)
                          }}
                        >
                          {copy().enter}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
          <Show when={problem()}>
            {(current) => (
              <div role="alert" class="alert alert-error">
                {copy()[current()]}
              </div>
            )}
          </Show>
          <Show when={problem() === 'notOpened'}>
            <p class="text-sm text-[var(--fuda-muted)]">{copy().startOverHint}</p>
            <ConfirmAction
              cancelLabel={copy().keepThem}
              confirmLabel={copy().startOver}
              description={copy().startOverWarning}
              label={copy().startOver}
              onConfirm={() => {
                void startOver()
              }}
              title={copy().startOverTitle}
            />
          </Show>
          <Show when={startedOver() === false}>
            <div role="alert" class="alert alert-error">
              {copy().startOverFailed}
            </div>
          </Show>
          <Show when={verdict()}>
            {(state) => (
              <Verdict
                locale={props.locale}
                state={state()}
                onDone={() => {
                  setVerdict(null)
                }}
              />
            )}
          </Show>
        </section>
      </Show>
    </>
  )
}
