/** @jsxImportSource hono/jsx/dom */
import { asHex, fetchRightsByHolder, normalizeUid } from '@fuda/sdk'
import type { GraphRight, Hex } from '@fuda/sdk'
import { short } from '@fuda/ui'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { verifyUid } from './api.ts'
import { GRAPH_RIGHTS_ENDPOINT } from './config.ts'
import {
  applePassAvailable,
  googlePassHref,
  loadMemberPassList,
  rememberQueryPass,
  refreshPassStatuses,
  withConnectedAddress,
} from './member-pass-list.ts'
import type { MemberPassListIo, MemberPassListResult, MemberPassRow } from './member-pass-list.ts'
import { readPassMemory, rememberPass } from './pass-memory.ts'
import type { PassMemoryEntry } from './pass-memory.ts'
import { injectedProvider, requestAccount } from './wallet.ts'
import type { Eip1193Provider } from './wallet.ts'

export type RightsListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rights: GraphRight[] }

type MemberListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; result: MemberPassListResult }

const SAFE_META_PROTOCOLS = new Set(['http:', 'https:', 'ipfs:'])

const safeMetaHref = (value: string): string | null => {
  if (!URL.canParse(value)) {
    return null
  }
  return SAFE_META_PROTOCOLS.has(new URL(value).protocol) ? value : null
}

const metaUri = (value: string): JSX.Element | null => {
  if (value === '') {
    return null
  }
  const href = safeMetaHref(value)
  return href === null ? <span>{value}</span> : <a href={href}>{value}</a>
}

const graphCard = (right: GraphRight): JSX.Element => (
  <li class="card bg-base-200" key={right.id}>
    <div class="card-body gap-2">
      <div class={right.revokedAt === null ? 'badge badge-success' : 'badge badge-error'}>
        {right.revokedAt === null ? 'ACTIVE' : 'REVOKED'}
      </div>
      <div class="font-mono text-xs break-all">{right.id}</div>
      <div class="text-sm">issuer {short(right.issuer)}</div>
      <div class="text-sm">tier {right.tier}</div>
      <div class="text-sm">usage model {right.usageModel}</div>
      {metaUri(right.metaURI)}
    </div>
  </li>
)

const memberStatus = (row: MemberPassRow): string => {
  if (row.preview === null) {
    return 'Status unavailable'
  }
  return row.preview.decision === 'ADMIT' ? 'ACTIVE' : row.preview.reason
}

const memberCard = (row: MemberPassRow): JSX.Element => {
  const live = row.preview?.entitlement
  const issuer = live?.issuer ?? row.graph?.issuer
  const tier = live?.tier ?? row.graph?.tier
  const usageModel = live?.usageModel ?? row.graph?.usageModel
  const status = memberStatus(row)
  return (
    <li class="card bg-base-200" key={row.uid}>
      <div class="card-body gap-2">
        <div class={row.preview?.decision === 'ADMIT' ? 'badge badge-success' : 'badge badge-error'}>
          {status}
        </div>
        {row.graph === null ? <div class="badge badge-outline">Saved on this device</div> : null}
        <div class="font-mono text-xs break-all">{row.uid}</div>
        {issuer === undefined ? null : <div class="text-sm">issuer {short(issuer)}</div>}
        {tier === undefined ? null : <div class="text-sm">tier {tier}</div>}
        {usageModel === undefined ? null : <div class="text-sm">usage model {usageModel}</div>}
        {row.graph === null ? null : metaUri(row.graph.metaURI)}
        <div class="flex gap-3 text-sm">
          <a class="link" href={row.passes.web} target="_blank" rel="noreferrer">
            View pass
          </a>
          {row.googleHref === null ? null : (
            <a class="link" href={row.googleHref} target="_blank" rel="noreferrer">
              Google Wallet
            </a>
          )}
          {row.appleHref === null ? null : (
            <a class="link" href={row.appleHref} target="_blank" rel="noreferrer">
              Apple Wallet
            </a>
          )}
        </div>
      </div>
    </li>
  )
}

export const RightsListView = ({ state }: { state: RightsListState | MemberListState }): JSX.Element => {
  if (state.kind === 'idle') {
    return <p class="text-sm opacity-70">Enter a holder address to read its on-chain rights.</p>
  }
  if (state.kind === 'loading') {
    return <p class="text-sm opacity-70">Loading rights…</p>
  }
  if (state.kind === 'error') {
    return <div class="alert alert-error">{state.message}</div>
  }
  if ('rights' in state) {
    if (state.rights.length === 0) {
      return <p class="text-sm opacity-70">No rights found for this holder.</p>
    }
    return <ul class="grid gap-3 md:grid-cols-2">{state.rights.map(graphCard)}</ul>
  }
  if (state.result.rows.length === 0) {
    return <p class="text-sm opacity-70">No passes found yet.</p>
  }
  return <ul class="grid gap-3 md:grid-cols-2">{state.result.rows.map(memberCard)}</ul>
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement ? target.value : null

const passkeyRail = async (): Promise<Eip1193Provider> => {
  const { baseAccountProvider } = await import('./base-account.ts')
  return baseAccountProvider()
}

const defaultIo: MemberPassListIo = {
  appleAvailable: applePassAvailable,
  fetchRights: async (holder) => await fetchRightsByHolder(GRAPH_RIGHTS_ENDPOINT, holder),
  googleHref: googlePassHref,
  verify: verifyUid,
}

interface RightsListProps {
  io?: MemberPassListIo
  injected?: Eip1193Provider | null
  memory?: readonly PassMemoryEntry[]
  queryUid?: Hex | null
}

const queryUidFromLocation = (): Hex | null => {
  const raw = new URLSearchParams(globalThis.location?.search ?? '').get('uid')
  return raw === null ? null : normalizeUid(raw)
}

export const RightsList = ({
  io = defaultIo,
  injected: givenInjected,
  memory: givenMemory,
  queryUid,
}: RightsListProps): JSX.Element => {
  const injected = givenInjected === undefined ? injectedProvider() : givenInjected
  const [addresses, setAddresses] = useState<Hex[]>([])
  const [memory, setMemory] = useState<PassMemoryEntry[]>(() => [...(givenMemory ?? readPassMemory())])
  const [state, setState] = useState<MemberListState>({ kind: 'loading' })
  const [manual, setManual] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const uid = queryUid === undefined ? queryUidFromLocation() : queryUid

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const result = await loadMemberPassList(
          { addresses, graphConfigured: GRAPH_RIGHTS_ENDPOINT !== '', memory },
          io,
        )
        if (current) {
          setState({ kind: 'ready', result })
        }
      } catch (error) {
        if (current) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'Pass list failed.' })
        }
      }
    })()
    return () => {
      current = false
    }
  }, [addresses, io, memory])

  useEffect(() => {
    if (uid === null) {
      return
    }
    void (async () => {
      try {
        await rememberQueryPass(uid, io.verify, (pass) => {
          setMemory(rememberPass(pass))
        })
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not load this pass.')
      }
    })()
  }, [io, uid])

  useEffect(() => {
    const interval = globalThis.setInterval(() => {
      if (globalThis.document.visibilityState !== 'visible' || state.kind !== 'ready') {
        return
      }
      void (async () => {
        try {
          const rows = await refreshPassStatuses(state.result.rows, io.verify)
          setState({ kind: 'ready', result: { ...state.result, rows } })
        } catch (error) {
          setProblem(error instanceof Error ? error.message : 'Could not refresh pass status.')
        }
      })()
    }, 30_000)
    return () => {
      globalThis.clearInterval(interval)
    }
  }, [io.verify, state])

  const addAddress = (address: Hex): void => {
    setAddresses((stored) => withConnectedAddress(stored, address))
  }

  const connect = async (open: () => Promise<Eip1193Provider>): Promise<void> => {
    setProblem(null)
    try {
      addAddress(await requestAccount(await open()))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not connect wallet.')
    }
  }

  const lookup = (): void => {
    const holder = asHex(manual.trim(), 20)
    if (holder === null) {
      setProblem('Enter a valid holder address.')
      return
    }
    setProblem(null)
    addAddress(holder)
  }

  const indexUnavailable = state.kind === 'ready' && state.result.indexUnavailable
  return (
    <main class="flex min-h-screen flex-col gap-4 p-6">
      <h1 class="text-xl font-bold">Your passes</h1>
      <p class="text-sm opacity-70">
        Connect a passkey or wallet to find public passes. Passes saved on this device appear here too. For
        private discovery, use +Private.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          class="btn btn-primary"
          type="button"
          onClick={() => {
            void connect(passkeyRail)
          }}
        >
          Connect passkey
        </button>
        {injected === null ? null : (
          <button
            class="btn"
            type="button"
            onClick={() => {
              void connect(async () => await Promise.resolve(injected))
            }}
          >
            Use wallet
          </button>
        )}
        <a class="btn btn-ghost" href="/private">
          Private rights →
        </a>
      </div>
      <details>
        <summary class="cursor-pointer">Look up another address</summary>
        <form
          class="mt-2 flex max-w-xl gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            lookup()
          }}
        >
          <input
            class="input input-bordered grow font-mono"
            aria-label="Holder address"
            placeholder="0x… holder address"
            value={manual}
            onInput={(event) => {
              const value = fieldValue(event.currentTarget)
              if (value !== null) {
                setManual(value)
              }
            }}
          />
          <button class="btn" type="submit">
            Look up
          </button>
        </form>
      </details>
      {indexUnavailable ? (
        <div class="alert alert-warning">The public rights index is unavailable.</div>
      ) : null}
      {problem === null ? null : <div class="alert alert-error">{problem}</div>}
      <RightsListView state={state} />
    </main>
  )
}
