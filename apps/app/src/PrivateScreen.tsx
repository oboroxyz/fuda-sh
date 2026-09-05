/** @jsxImportSource hono/jsx/dom */
import type { Hex } from '@fuda/sdk'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth'
import { short } from '@fuda/web-kit'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { announcements, challenge, verifySigned } from './api.ts'
import { RP_ID } from './config.ts'
import type { PrfResult } from './passkey.ts'
import { displayOf, enterSigned } from './signed-gate.ts'
import type { SignedDisplay } from './signed-gate.ts'
import { Verdict } from './Verdict.tsx'

// Member-facing copy for the three ways a PRF ceremony ends without a secret.
const PRF_COPY = {
  cancelled: 'The passkey prompt was dismissed. Try again when you are ready.',
  error: 'The passkey ceremony failed.',
  unsupported:
    'This passkey or device cannot derive a +Private key (no PRF support). Try a platform passkey on a recent phone or browser.',
} as const

// The stealth curve code and the WebAuthn ceremony are only ever needed once a
// member is on this screen, and the same Worker serves the public apex landing:
// both are fetched on demand so the landing bundle carries neither.
const stealthKit = async () => await import('./private-member.ts')
const passkeyKit = async () => await import('./passkey.ts')

const MetaAddress = ({
  keys,
  onDiscover,
  busy,
}: {
  keys: StealthKeys
  onDiscover: () => void
  busy: boolean
}): JSX.Element => {
  const [copied, setCopied] = useState(false)
  const copy = async (value: Hex): Promise<void> => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
  }
  return (
    <div class="flex w-full max-w-md flex-col gap-2">
      <div class="text-sm font-bold">Your meta-address</div>
      <div class="font-mono text-xs break-all">{keys.metaAddress}</div>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-sm"
          onClick={() => {
            void copy(keys.metaAddress)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" class="btn btn-sm btn-primary" disabled={busy} onClick={onDiscover}>
          Discover my passes
        </button>
      </div>
    </div>
  )
}

// Spec §10.2: (a) passkey → meta-address, (b) discover, (c) enter with the
// recovered stealth key through the same challenge flow as Signed.
export const PrivateScreen = (): JSX.Element => {
  const [keys, setKeys] = useState<StealthKeys | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [passes, setPasses] = useState<DiscoveredPass[] | null>(null)
  const [state, setState] = useState<SignedDisplay | null>(null)
  const [busy, setBusy] = useState(false)

  const settle = async (result: PrfResult): Promise<void> => {
    if (!result.ok) {
      setProblem(`${PRF_COPY[result.reason]} (${result.detail})`)
      return
    }
    const { keysFromPrf } = await stealthKit()
    setKeys(keysFromPrf(result.output))
    setProblem(null)
  }

  // Every button funnels through here, so a failed chunk fetch or a broken
  // clipboard reads as a message on screen rather than an unhandled rejection.
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const find = async (k: StealthKeys): Promise<void> => {
    const res = await announcements(0)
    if (!res.ok) {
      setProblem(res.network ? 'Could not reach the api — try again.' : res.error)
      return
    }
    const { discover } = await stealthKit()
    setPasses(discover(k, res.body.announcements))
  }

  const enter = async (pass: DiscoveredPass): Promise<void> => {
    const { stealthSigner } = await stealthKit()
    const outcome = await enterSigned(
      { challenge, sign: stealthSigner(pass), verify: verifySigned },
      pass.uid,
    )
    setState(displayOf(outcome))
  }

  if (state !== null) {
    return (
      <Verdict
        state={state}
        onDone={() => {
          setState(null)
        }}
      />
    )
  }
  return (
    <main class="flex min-h-screen flex-col items-center gap-4 p-4">
      <h1 class="text-xl font-bold">+Private</h1>
      <p class="text-center text-sm opacity-70">
        Your passkey derives a meta-address. Give it to the Venue; your pass lands on a one-time address only
        you can find.
      </p>
      {keys === null ? (
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const { createPasskey } = await passkeyKit()
                await settle(await createPasskey(RP_ID, 'fuda member'))
              })
            }}
          >
            Create passkey
          </button>
          <button
            type="button"
            class="btn"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const { loadPasskey } = await passkeyKit()
                await settle(await loadPasskey(RP_ID))
              })
            }}
          >
            Use existing passkey
          </button>
        </div>
      ) : (
        <MetaAddress
          keys={keys}
          busy={busy}
          onDiscover={() => {
            void run(async () => {
              await find(keys)
            })
          }}
        />
      )}
      {problem === null ? null : <div class="alert alert-error text-sm">{problem}</div>}
      {passes === null ? null : (
        <ul class="flex w-full max-w-md flex-col gap-2">
          {passes.length === 0 ? (
            <li class="text-sm opacity-70">No pass announced to this meta-address yet.</li>
          ) : null}
          {passes.map((pass): JSX.Element => (
            <li class="card bg-base-200" key={pass.uid}>
              <div class="card-body gap-2">
                <div class="font-mono text-xs break-all">{pass.uid}</div>
                <div class="text-xs opacity-70">stealth address {short(pass.stealthAddress)}</div>
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
                  Enter
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
