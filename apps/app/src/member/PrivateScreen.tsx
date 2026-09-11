/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { fetchAnnouncements } from '@fuda/sdk'
import type { GraphAnnouncement, Hex } from '@fuda/sdk'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth-address'
import { short } from '@fuda/ui'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { challenge, verifySigned } from '../api.ts'
import { GRAPH_RIGHTS_ENDPOINT, RP_ID } from '../config.ts'
import type { PrfResult } from '../passkey.ts'
import { displayOf, enterSigned } from '../signed-gate.ts'
import type { SignedDisplay } from '../signed-gate.ts'
import { ENTRY_COPY, entryMessage } from './entry-copy.ts'
import { Verdict } from './Verdict.tsx'

type PrivateProblem =
  | { kind: 'error'; detail: string }
  | (Extract<PrfResult, { ok: false }> & { kind: 'prf' })

// The stealth curve code and the WebAuthn ceremony are fetched on demand once a
// member opens this screen.
const stealthKit = async () => await import('../private-member.ts')
const passkeyKit = async () => await import('../passkey.ts')

const MetaAddress = ({
  keys,
  onDiscover,
  busy,
  locale,
}: {
  keys: StealthKeys
  onDiscover: () => void
  busy: boolean
  locale: Locale
}): JSX.Element => {
  const c = pick(ENTRY_COPY, locale)
  // The clipboard is denied outright in some browsers when the document is not
  // focused, so the button reports the failure instead of rejecting silently:
  // the meta-address is on screen and can still be selected by hand.
  const [copied, setCopied] = useState<'done' | 'failed' | 'idle'>('idle')
  const copy = async (value: Hex): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }
  return (
    <div class="flex w-full max-w-md flex-col gap-2">
      <div class="text-sm font-bold">{c.metaAddress}</div>
      <div class="font-mono text-xs break-all">{keys.metaAddress}</div>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-sm"
          onClick={() => {
            void copy(keys.metaAddress)
          }}
        >
          {c.copy[copied]}
        </button>
        <button type="button" class="btn btn-sm btn-primary" disabled={busy} onClick={onDiscover}>
          {c.discover}
        </button>
      </div>
    </div>
  )
}

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

  // Every button funnels through here, so a failed chunk fetch or a broken
  // clipboard reads as a message on screen rather than an unhandled rejection.
  const run = async (fn: () => Promise<void>): Promise<void> => {
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
    const { stealthSigner } = await io.stealth()
    signal.throwIfAborted()
    const outcome = await enterSigned(
      { challenge, sign: stealthSigner(pass), verify: verifySigned },
      pass.uid,
      signal,
    )
    signal.throwIfAborted()
    setState(displayOf(outcome))
  }

  if (state !== null) {
    return (
      <Verdict
        locale={locale}
        state={state}
        onDone={() => {
          setState(null)
        }}
      />
    )
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
        <MetaAddress
          locale={locale}
          keys={keys}
          busy={busy}
          onDiscover={() => {
            void run(async () => {
              await find(keys)
            })
          }}
        />
      )}
      {problem === null ? null : (
        <div class="alert alert-error text-sm">
          {problem.kind === 'prf'
            ? `${c.prf[problem.reason]} (${entryMessage(problem.detail, locale)})`
            : entryMessage(problem.detail, locale)}
        </div>
      )}
      {passes === null ? null : (
        <ul class="flex w-full max-w-md flex-col gap-2">
          {passes.length === 0 ? <li class="text-sm opacity-70">{c.noPasses}</li> : null}
          {passes.map((pass): JSX.Element => (
            <li class="card bg-base-200" key={pass.uid}>
              <div class="card-body gap-2">
                <div class="font-mono text-xs break-all">{pass.uid}</div>
                <div class="text-xs opacity-70">
                  {c.stealthAddress} {short(pass.stealthAddress)}
                </div>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await enter(pass)
                    })
                  }}
                >
                  {c.enter}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
