/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { fetchAnnouncements } from '@fuda/sdk'
import type { GraphAnnouncement } from '@fuda/sdk'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth-address'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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

export const PrivateScreen = ({
  io = DEFAULT_IO,
  locale = DEFAULT_LOCALE,
}: {
  io?: PrivateScreenIo
  locale?: Locale
}): JSX.Element => {
  const c = pick(ENTRY_COPY, locale)
  const [keys, setKeys] = useState<StealthKeys | null>(null)
  const [problem, setProblem] = useState<PrivateProblem | null>(null)
  const [passes, setPasses] = useState<DiscoveredPass[] | null>(null)
  const [state, setState] = useState<SignedDisplay | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const dialogOpener = useRef<HTMLElement | null>(null)
  const [modal, setModal] = useState<
    | { kind: 'meta' }
    | { kind: 'details'; pass: DiscoveredPass }
    | { kind: 'verify'; pass: DiscoveredPass }
    | null
  >(null)
  const [lifetime] = useState(() => new AbortController())
  const { signal } = lifetime

  useEffect(
    () => () => {
      lifetime.abort()
    },
    [lifetime],
  )

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
    if (running.current) {
      return
    }
    running.current = true
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
      running.current = false
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

  return (
    <main class="member-page member-page-narrow flex flex-col items-center gap-6">
      <h1 class="member-heading">+Private</h1>
      <p class="text-center text-sm leading-relaxed text-[var(--fuda-muted)]">{c.privateIntro}</p>
      {keys === null ? (
        <div class="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const { loadPasskey } = await io.passkeys()
                signal.throwIfAborted()
                await settle(await loadPasskey(RP_ID))
              })
            }}
          >
            {c.usePasskey}
          </button>
          <button
            type="button"
            class="btn btn-outline"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const { createPasskey } = await io.passkeys()
                signal.throwIfAborted()
                await settle(await createPasskey(RP_ID, 'fuda member'))
              })
            }}
          >
            {c.createPasskey}
          </button>
        </div>
      ) : (
        <section class="w-full" aria-label={c.metaAddress}>
          <h2 class="flex items-center gap-2 text-sm font-semibold">
            <PrivateIcon kind="key" />
            {c.metaAddress}
          </h2>
          <div class="member-private-row">
            <span class="min-w-0 grow font-mono text-xs min-[360px]:text-sm">
              {privateShort(keys.metaAddress)}
            </span>
            <div class="flex shrink-0 items-center">
              <PrivateAction
                kind="details"
                label={c.privateUi.metaDetails}
                onClick={(button) => {
                  dialogOpener.current = button
                  setModal({ kind: 'meta' })
                }}
              />
              <PrivateCopy locale={locale} value={keys.metaAddress} />
              <PrivateAction
                kind="search"
                label={c.discover}
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await find(keys)
                  })
                }}
              />
            </div>
          </div>
        </section>
      )}
      {problem === null ? null : (
        <div class="alert alert-error text-sm">
          {problem.kind === 'prf'
            ? `${c.prf[problem.reason]} (${entryMessage(problem.detail, locale)})`
            : entryMessage(problem.detail, locale)}
        </div>
      )}
      {passes === null ? null : (
        <section class="w-full" aria-label={c.privateUi.rights}>
          <h2 class="text-sm font-semibold">{c.privateUi.rights}</h2>
          <p class="mt-2 flex items-center gap-2 text-xs text-[var(--fuda-muted)]">
            <PrivateIcon kind="sign" />
            {c.privateUi.signHint}
          </p>
          <ul class="mt-2 w-full">
            {passes.length === 0 ? <li class="py-4 text-sm opacity-70">{c.noPasses}</li> : null}
            {passes.map((pass): JSX.Element => (
              <li class="member-private-row" key={pass.uid}>
                <div class="min-w-0 grow space-y-2">
                  <div class="flex items-center gap-2">
                    <PrivateIcon kind="right" />
                    <span class="sr-only">{c.privateUi.rightId} </span>
                    <span class="font-mono text-sm">{privateShort(pass.uid)}</span>
                  </div>
                  <div class="flex items-center gap-2 text-[var(--fuda-muted)]" title={c.stealthAddress}>
                    <PrivateIcon kind="stealth" />
                    <span class="sr-only">{c.stealthAddress} </span>
                    <span class="font-mono text-xs">{privateShort(pass.stealthAddress)}</span>
                  </div>
                </div>
                <div class="flex shrink-0 items-center">
                  <PrivateAction
                    kind="details"
                    label={`${c.privateUi.rightDetails}: ${privateShort(pass.uid)}`}
                    onClick={(button) => {
                      dialogOpener.current = button
                      setModal({ kind: 'details', pass })
                    }}
                  />
                  <PrivateAction
                    kind="sign"
                    label={`${c.privateUi.signVerify}: ${privateShort(pass.uid)}`}
                    disabled={busy}
                    onClick={(button) => {
                      dialogOpener.current = button
                      void run(async () => {
                        await enter(pass)
                      })
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {modal === null ? null : (
        <PrivateDialog
          opener={dialogOpener.current}
          title={
            {
              details: c.privateUi.rightDetails,
              meta: c.privateUi.metaDetails,
              verify: c.privateUi.signVerify,
            }[modal.kind]
          }
          closeLabel={c.privateUi.close}
          onClose={() => {
            setModal(null)
          }}
        >
          {modal.kind === 'verify' ? (
            <div class="mt-5" role="status" aria-live="polite" aria-atomic="true">
              <p class="text-sm text-[var(--fuda-muted)]">
                {c.privateUi.rightId} <span class="font-mono">{privateShort(modal.pass.uid)}</span>
              </p>
              {state === null ? (
                <div class="my-8 flex flex-col items-center gap-4">
                  <span class="loading loading-spinner loading-lg" aria-hidden="true" />
                  <p>{c.privateUi.verifying}</p>
                </div>
              ) : (
                <div class="my-6 text-center">
                  <p
                    class={
                      state.tone === 'green'
                        ? 'text-success text-4xl font-bold'
                        : 'text-error text-4xl font-bold'
                    }
                  >
                    {c.verdict[state.title]}
                  </p>
                  <p class="mt-3 text-sm break-words">
                    {state.title === 'ADMIT' ? c.privateUi.verified : entryMessage(state.detail, locale)}
                  </p>
                  {state.banner === 'network' ? <p class="mt-3 text-sm">{c.networkBanner}</p> : null}
                </div>
              )}
            </div>
          ) : (
            <PrivateDetails
              locale={locale}
              fields={
                modal.kind === 'meta'
                  ? [{ label: c.metaAddress, value: keys?.metaAddress ?? '' }]
                  : [
                      { label: c.privateUi.rightId, value: modal.pass.uid },
                      { label: c.stealthAddress, value: modal.pass.stealthAddress },
                    ]
              }
            />
          )}
        </PrivateDialog>
      )}
    </main>
  )
}
