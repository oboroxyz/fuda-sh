import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { fetchAnnouncements } from '@fuda/sdk'
import type { GraphAnnouncement } from '@fuda/sdk'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth-address'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'

import { challenge, verifySigned } from '../api.ts'
import { GRAPH_RIGHTS_ENDPOINT, RP_ID } from '../config.ts'
import type { PrfResult } from '../passkey.ts'
import { displayOf, enterSigned } from '../signed-gate.ts'
import type { SignedDisplay } from '../signed-gate.ts'
import { ENTRY_COPY, entryMessage } from './entry-copy.ts'
import { PrivateAction, PrivateCopy, PrivateDetails, PrivateDialog, PrivateIcon } from './PrivateControls.tsx'

// Keep eight hex digits after 0x and six at the end for visual identification.
const privateShort = (value: string): string => `${value.slice(0, 10)}…${value.slice(-6)}`

type PrivateProblem =
  | { kind: 'error'; detail: string }
  | (Extract<PrfResult, { ok: false }> & { kind: 'prf' })

// The stealth curve code and the WebAuthn ceremony are fetched on demand once a
// member opens this screen.
const stealthKit = async () => await import('../private-member.ts')
const passkeyKit = async () => await import('../passkey.ts')

// docs/specs/pass-types-and-flows.md#u2-privacy-first-issuance: (a) passkey → meta-address, (b) discover, (c) enter with the
// recovered stealth key through the same challenge flow as Signed.
interface PrivateScreenIo {
  fetchRows: (endpoint: string, from: bigint) => Promise<GraphAnnouncement[]>
  passkeys: () => Promise<{
    createPasskey: (rpId: string, name: string) => Promise<PrfResult>
    loadPasskey: (rpId: string) => Promise<PrfResult>
  }>
  stealth: typeof stealthKit
}

const DEFAULT_IO: PrivateScreenIo = {
  fetchRows: fetchAnnouncements,
  passkeys: passkeyKit,
  stealth: stealthKit,
}

type PrivateModal =
  | { kind: 'meta' }
  | { kind: 'details'; pass: DiscoveredPass }
  | { kind: 'verify'; pass: DiscoveredPass }

export const PrivateScreen = (props: { io?: PrivateScreenIo; locale?: Locale }): JSX.Element => {
  const io = props.io ?? DEFAULT_IO
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const c = (): (typeof ENTRY_COPY)[Locale] => pick(ENTRY_COPY, locale())
  const [keys, setKeys] = createSignal<StealthKeys | null>(null)
  const [problem, setProblem] = createSignal<PrivateProblem | null>(null)
  const [passes, setPasses] = createSignal<DiscoveredPass[] | null>(null)
  const [state, setState] = createSignal<SignedDisplay | null>(null)
  const [busy, setBusy] = createSignal(false)
  let running = false
  let dialogOpener: HTMLElement | null = null
  const [modal, setModal] = createSignal<PrivateModal | null>(null)
  const lifetime = new AbortController()
  const { signal } = lifetime

  onCleanup(() => {
    lifetime.abort()
  })

  const settle = async (result: PrfResult): Promise<void> => {
    signal.throwIfAborted()
    if (!result.ok) {
      setProblem({ ...result, kind: 'prf' })
      return
    }
    const { keysFromPrf } = await io.stealth()
    signal.throwIfAborted()
    const nextKeys = keysFromPrf(result.output)
    signal.throwIfAborted()
    setKeys(nextKeys)
    setProblem(null)
  }

  // Serialize credential, discovery and entry attempts, including same-tick clicks.
  // Failed chunk fetches are reported instead of becoming unhandled rejections.
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (running) {
      return
    }
    running = true
    // Cleared on entry, so a banner from the previous attempt is never read as
    // the outcome of this one.
    setProblem(null)
    setBusy(true)
    try {
      await fn()
    } catch (error) {
      if (signal.aborted) {
        return
      }
      setProblem({ detail: error instanceof Error ? error.message : 'something went wrong', kind: 'error' })
    } finally {
      running = false
      if (!signal.aborted) {
        setBusy(false)
      }
    }
  }

  const find = async (k: StealthKeys): Promise<void> => {
    if (GRAPH_RIGHTS_ENDPOINT === '') {
      throw new Error('Rights discovery is not configured.')
    }
    const rows = await io.fetchRows(GRAPH_RIGHTS_ENDPOINT, 0n)
    signal.throwIfAborted()
    const { discover } = await io.stealth()
    signal.throwIfAborted()
    const discovered = discover(k, rows)
    signal.throwIfAborted()
    setPasses(discovered)
  }

  const enter = async (pass: DiscoveredPass): Promise<void> => {
    setState(null)
    setModal({ kind: 'verify', pass })
    try {
      const { stealthSigner } = await io.stealth()
      signal.throwIfAborted()
      const outcome = await enterSigned(
        { challenge, sign: stealthSigner(pass), verify: verifySigned },
        pass.uid,
        signal,
      )
      signal.throwIfAborted()
      setState(displayOf(outcome))
    } catch (error) {
      if (!signal.aborted) {
        setState(
          displayOf({
            error: error instanceof Error ? error.message : 'something went wrong',
            kind: 'error',
            network: false,
          }),
        )
      }
    }
  }

  const problemText = (current: PrivateProblem): string =>
    current.kind === 'prf'
      ? `${c().prf[current.reason]} (${entryMessage(current.detail, locale())})`
      : entryMessage(current.detail, locale())

  const passRow = (pass: DiscoveredPass): JSX.Element => (
    <li class="member-private-row">
      <div class="min-w-0 grow space-y-2">
        <div class="flex items-center gap-2">
          <PrivateIcon kind="right" />
          <span class="sr-only">{c().privateUi.rightId} </span>
          <span class="font-mono text-sm">{privateShort(pass.uid)}</span>
        </div>
        <div class="flex items-center gap-2 text-[var(--fuda-muted)]" title={c().stealthAddress}>
          <PrivateIcon kind="stealth" />
          <span class="sr-only">{c().stealthAddress} </span>
          <span class="font-mono text-xs">{privateShort(pass.stealthAddress)}</span>
        </div>
      </div>
      <div class="flex shrink-0 items-center">
        <PrivateAction
          kind="details"
          label={`${c().privateUi.rightDetails}: ${privateShort(pass.uid)}`}
          onClick={(button) => {
            dialogOpener = button
            setModal({ kind: 'details', pass })
          }}
        />
        <PrivateAction
          kind="sign"
          label={`${c().privateUi.signVerify}: ${privateShort(pass.uid)}`}
          disabled={busy()}
          onClick={(button) => {
            dialogOpener = button
            void run(async () => {
              await enter(pass)
            })
          }}
        />
      </div>
    </li>
  )

  const verdictPanel = (pass: DiscoveredPass): JSX.Element => (
    <div class="mt-5" role="status" aria-live="polite" aria-atomic="true">
      <p class="text-sm text-[var(--fuda-muted)]">
        {c().privateUi.rightId} <span class="font-mono">{privateShort(pass.uid)}</span>
      </p>
      <Show
        when={state()}
        fallback={
          <div class="my-8 flex flex-col items-center gap-4">
            <span class="loading loading-spinner loading-lg" aria-hidden="true" />
            <p>{c().privateUi.verifying}</p>
          </div>
        }
      >
        {(verdict) => (
          <div class="my-6 text-center">
            <p
              class={
                verdict().tone === 'green'
                  ? 'text-success text-4xl font-bold'
                  : 'text-error text-4xl font-bold'
              }
            >
              {c().verdict[verdict().title]}
            </p>
            <p class="mt-3 text-sm break-words">
              {verdict().title === 'ADMIT'
                ? c().privateUi.verified
                : entryMessage(verdict().detail, locale())}
            </p>
            {verdict().banner === 'network' ? <p class="mt-3 text-sm">{c().networkBanner}</p> : null}
          </div>
        )}
      </Show>
    </div>
  )

  const dialog = (current: Accessor<PrivateModal>): JSX.Element => (
    <PrivateDialog
      opener={dialogOpener}
      title={
        {
          details: c().privateUi.rightDetails,
          meta: c().privateUi.metaDetails,
          verify: c().privateUi.signVerify,
        }[current().kind]
      }
      closeLabel={c().privateUi.close}
      onClose={() => {
        setModal(null)
      }}
    >
      {(() => {
        const open = current()
        if (open.kind === 'verify') {
          return verdictPanel(open.pass)
        }
        return (
          <PrivateDetails
            locale={locale()}
            fields={
              open.kind === 'meta'
                ? [{ label: c().metaAddress, value: keys()?.metaAddress ?? '' }]
                : [
                    { label: c().privateUi.rightId, value: open.pass.uid },
                    { label: c().stealthAddress, value: open.pass.stealthAddress },
                  ]
            }
          />
        )
      })()}
    </PrivateDialog>
  )

  return (
    <main class="member-page member-page-narrow flex flex-col items-center gap-6">
      <h1 class="member-heading">+Private</h1>
      <p class="text-center text-sm leading-relaxed text-[var(--fuda-muted)]">{c().privateIntro}</p>
      <Show
        when={keys()}
        fallback={
          <div class="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy()}
              onClick={() => {
                void run(async () => {
                  const { loadPasskey } = await io.passkeys()
                  signal.throwIfAborted()
                  await settle(await loadPasskey(RP_ID))
                })
              }}
            >
              {c().usePasskey}
            </button>
            <button
              type="button"
              class="btn btn-outline"
              disabled={busy()}
              onClick={() => {
                void run(async () => {
                  const { createPasskey } = await io.passkeys()
                  signal.throwIfAborted()
                  await settle(await createPasskey(RP_ID, 'fuda member'))
                })
              }}
            >
              {c().createPasskey}
            </button>
          </div>
        }
      >
        {(current) => (
          <section class="w-full" aria-label={c().metaAddress}>
            <h2 class="flex items-center gap-2 text-sm font-semibold">
              <PrivateIcon kind="key" />
              {c().metaAddress}
            </h2>
            <div class="member-private-row">
              <span class="min-w-0 grow font-mono text-xs min-[360px]:text-sm">
                {privateShort(current().metaAddress)}
              </span>
              <div class="flex shrink-0 items-center">
                <PrivateAction
                  kind="details"
                  label={c().privateUi.metaDetails}
                  onClick={(button) => {
                    dialogOpener = button
                    setModal({ kind: 'meta' })
                  }}
                />
                <PrivateCopy locale={locale()} value={current().metaAddress} />
                <PrivateAction
                  kind="search"
                  label={c().discover}
                  disabled={busy()}
                  onClick={() => {
                    const found = current()
                    void run(async () => {
                      await find(found)
                    })
                  }}
                />
              </div>
            </div>
          </section>
        )}
      </Show>
      <Show when={problem()}>
        {(current) => <div class="alert alert-error text-sm">{problemText(current())}</div>}
      </Show>
      <Show when={passes()}>
        {(found) => (
          <section class="w-full" aria-label={c().privateUi.rights}>
            <h2 class="text-sm font-semibold">{c().privateUi.rights}</h2>
            <p class="mt-2 flex items-center gap-2 text-xs text-[var(--fuda-muted)]">
              <PrivateIcon kind="sign" />
              {c().privateUi.signHint}
            </p>
            <ul class="mt-2 w-full">
              {found().length === 0 ? <li class="py-4 text-sm opacity-70">{c().noPasses}</li> : null}
              <For each={found()}>{(pass) => passRow(pass)}</For>
            </ul>
          </section>
        )}
      </Show>
      <Show when={modal()}>{(current) => dialog(current)}</Show>
    </main>
  )
}
