import { useQuery, useQueryScope } from '@fuda/libs/query'
import type { QueryClient } from '@fuda/libs/query'
/** @jsxImportSource hono/jsx/dom */
import { asHex, fetchRightsByHolder, normalizeUid } from '@fuda/sdk'
import type { GraphRight, Hex } from '@fuda/sdk'
import { short } from '@fuda/ui'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { verifyUid } from '../api.ts'
import { API_BASE_URL, GRAPH_RIGHTS_ENDPOINT } from '../config.ts'
import {
  applePassAvailable,
  connectMemberRail,
  googlePassHref,
  PrivatePassRecoveryError,
  withConnectedAddress,
} from '../member-pass-list.ts'
import type { MemberPassListIo, MemberPassListResult, MemberPassRow } from '../member-pass-list.ts'
import { memberPassListQueryOptions, memberPassRecoveryQueryOptions } from '../member-pass-query.ts'
import { readPassMemory, rememberPass } from '../pass-memory.ts'
import type { PassMemoryEntry } from '../pass-memory.ts'
import { injectedProvider, requestAccount } from '../wallet.ts'
import type { Eip1193Provider } from '../wallet.ts'

export type RightsListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rights: GraphRight[] }

type MemberListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; result: MemberPassListResult }

const memberListState = (data: MemberPassListResult | undefined, error: Error | null): MemberListState => {
  if (data !== undefined) {
    return { kind: 'ready', result: data }
  }
  if (error !== null) {
    return { kind: 'error', message: error.message }
  }
  return { kind: 'loading' }
}

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
  <li class="card member-pass" key={right.id}>
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

const memberPassLinks = (row: MemberPassRow, publicPass: boolean): JSX.Element | null => {
  if (!publicPass) {
    return null
  }
  return (
    <div class="member-pass-actions">
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
  )
}

const hasPublicPass = (row: MemberPassRow): boolean =>
  [row.preview?.entitlement?.level, row.graph?.level].some((level) => level === 0 || level === 1)

const memberMetadata = (row: MemberPassRow): JSX.Element => {
  const live = row.preview?.entitlement
  const issuer = live?.issuer ?? row.graph?.issuer
  const tier = live?.tier ?? row.graph?.tier
  const usageModel = live?.usageModel ?? row.graph?.usageModel
  return (
    <>
      {issuer === undefined ? null : <div class="text-sm">issuer {short(issuer)}</div>}
      {tier === undefined ? null : <div class="text-sm">tier {tier}</div>}
      {usageModel === undefined ? null : <div class="text-sm">usage model {usageModel}</div>}
      {row.graph === null ? null : metaUri(row.graph.metaURI)}
    </>
  )
}

const memberCard = (row: MemberPassRow): JSX.Element => {
  const publicPass = hasPublicPass(row)
  const status = memberStatus(row)
  return (
    <li class="card member-pass" key={row.uid}>
      <div class="card-body gap-2">
        <div class={row.preview?.decision === 'ADMIT' ? 'badge badge-success' : 'badge badge-error'}>
          {status}
        </div>
        {row.graph === null ? <div class="badge badge-outline">Saved on this device</div> : null}
        <h2 class="text-lg font-bold">Pass</h2>
        <div class="text-sm text-[var(--fuda-muted)]">
          UID <span class="font-mono">{short(row.uid)}</span>
        </div>
        <details class="text-xs text-[var(--fuda-muted)]">
          <summary class="min-h-11 cursor-pointer py-3 font-semibold">Full UID</summary>
          <div class="font-mono break-all">{row.uid}</div>
        </details>
        {memberMetadata(row)}
        {memberPassLinks(row, publicPass)}
      </div>
    </li>
  )
}

export const RightsListView = ({ state }: { state: RightsListState | MemberListState }): JSX.Element => {
  if (state.kind === 'idle') {
    return <p class="text-sm opacity-70">Enter a holder address to read its on-chain rights.</p>
  }
  if (state.kind === 'loading') {
    return (
      <p class="member-empty flex items-center justify-center gap-3" role="status">
        <span class="loading loading-spinner loading-sm" aria-hidden="true" />
        Loading rights…
      </p>
    )
  }
  if (state.kind === 'error') {
    return <div class="alert alert-error">{state.message}</div>
  }
  if ('rights' in state) {
    if (state.rights.length === 0) {
      return <p class="member-empty">No rights found for this holder.</p>
    }
    return <ul class="grid gap-3 md:grid-cols-2">{state.rights.map(graphCard)}</ul>
  }
  if (state.result.rows.length === 0) {
    return (
      <>
        {state.result.indexUnavailable ? (
          <div class="alert alert-warning">index unavailable; showing passes saved on this device</div>
        ) : null}
        <div class="member-empty">
          <p class="font-semibold text-[var(--fuda-text)]">No passes found yet.</p>
          <p class="mt-2">Open a card link or scan a QR from your venue to get started.</p>
        </div>
      </>
    )
  }
  return (
    <>
      {state.result.indexUnavailable ? (
        <div class="alert alert-warning">index unavailable; showing passes saved on this device</div>
      ) : null}
      <ul class="grid gap-3 md:grid-cols-2">{state.result.rows.map(memberCard)}</ul>
    </>
  )
}

export const QueryRecoveryNotice = ({
  onNavigate,
}: { onNavigate?: (path: string) => void } = {}): JSX.Element => (
  <div class="alert alert-warning">
    This is a +Private pass. Open Private rights to recover it.{' '}
    <a
      class="link"
      href="/private"
      onClick={(event) => {
        if (
          onNavigate !== undefined &&
          event.button === 0 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault()
          onNavigate('/private')
        }
      }}
    >
      Private rights
    </a>
  </div>
)

const problemNotice = (problem: Error | null, onNavigate?: (path: string) => void): JSX.Element | null => {
  if (problem === null) {
    return null
  }
  if (problem instanceof PrivatePassRecoveryError) {
    return <QueryRecoveryNotice onNavigate={onNavigate} />
  }
  return <div class="alert alert-error">{problem.message}</div>
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement ? target.value : null

const defaultIo: MemberPassListIo = {
  appleAvailable: applePassAvailable,
  fetchRights: async (holder) => await fetchRightsByHolder(GRAPH_RIGHTS_ENDPOINT, holder),
  googleHref: googlePassHref,
  verify: verifyUid,
}

interface RightsListProps {
  initialAddress?: Hex
  io?: MemberPassListIo
  injected?: Eip1193Provider | null
  memory?: readonly PassMemoryEntry[]
  queryClient?: QueryClient
  queryUid?: Hex | null
  onNavigate?: (path: string) => void
}

const queryUidFromLocation = (): Hex | null => {
  const raw = new URLSearchParams(globalThis.location?.search ?? '').get('uid')
  return raw === null ? null : normalizeUid(raw)
}

export const RightsList = ({
  initialAddress,
  io = defaultIo,
  injected: givenInjected,
  memory: givenMemory,
  queryClient: givenQueryClient,
  queryUid,
  onNavigate,
}: RightsListProps): JSX.Element => {
  const localQueryClient = useQueryScope()
  const queryClient = givenQueryClient ?? localQueryClient
  const injected = givenInjected === undefined ? injectedProvider() : givenInjected
  const [addresses, setAddresses] = useState<Hex[]>(initialAddress === undefined ? [] : [initialAddress])
  const [memory, setMemory] = useState<PassMemoryEntry[]>(() => [...(givenMemory ?? readPassMemory())])
  const [manual, setManual] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [problem, setProblem] = useState<Error | null>(null)
  const uid = queryUid === undefined ? queryUidFromLocation() : queryUid
  const listQuery = useQuery(
    queryClient,
    memberPassListQueryOptions(
      {
        addresses,
        apiEndpoint: API_BASE_URL,
        graphEndpoint: GRAPH_RIGHTS_ENDPOINT,
        memory,
      },
      io,
    ),
  )
  const recoveryQuery = useQuery(queryClient, memberPassRecoveryQueryOptions(uid, API_BASE_URL, io))
  const state = memberListState(listQuery.data, listQuery.error)
  const recoveryProblem =
    recoveryQuery.error === null || recoveryQuery.error instanceof PrivatePassRecoveryError
      ? recoveryQuery.error
      : new Error(`Could not recover this pass: ${recoveryQuery.error.message}`)
  const queryProblem = recoveryProblem ?? (listQuery.data === undefined ? null : listQuery.error)

  useEffect(() => {
    if (recoveryQuery.data === undefined || recoveryQuery.data === null) {
      return
    }
    setMemory(rememberPass(recoveryQuery.data))
  }, [recoveryQuery.data])

  const addAddress = (address: Hex): void => {
    setAddresses((stored) => withConnectedAddress(stored, address))
  }

  const connect = async (open: () => Promise<Eip1193Provider>): Promise<void> => {
    setProblem(null)
    try {
      addAddress(await connectMemberRail(open, requestAccount))
    } catch (error) {
      setProblem(error instanceof Error ? error : new Error('Could not connect wallet.'))
    }
  }

  const lookup = (): void => {
    const holder = asHex(manual.trim(), 20)
    if (holder === null) {
      setProblem(new Error('Enter a valid holder address.'))
      return
    }
    setProblem(null)
    addAddress(holder)
  }

  return (
    <main class="member-page flex flex-col gap-6">
      <header class="flex max-w-2xl flex-col gap-3">
        <p class="text-xs font-semibold tracking-widest text-[var(--fuda-muted)] uppercase">fuda · Member</p>
        <h1 class="member-heading">Your passes</h1>
        <p class="text-sm leading-relaxed text-[var(--fuda-muted)]">
          Public passes held by your verified address appear here with passes saved on this device.
        </p>
      </header>
      <section class="member-panel">
        <button
          aria-expanded={toolsOpen}
          class="flex min-h-11 w-full items-center justify-between text-left text-sm font-semibold"
          type="button"
          onClick={() => {
            setToolsOpen((open) => !open)
          }}
        >
          Look up another public address
          <span aria-hidden="true">{toolsOpen ? '−' : '+'}</span>
        </button>
        {toolsOpen ? (
          <div class="mt-4 flex flex-col gap-4 border-t border-[var(--fuda-border)] pt-4">
            {injected === null ? null : (
              <button
                class="btn"
                type="button"
                onClick={() => {
                  void connect(async () => await Promise.resolve(injected))
                }}
              >
                Use browser wallet
              </button>
            )}
            <form
              class="flex max-w-xl flex-col gap-2 sm:flex-row"
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
          </div>
        ) : null}
      </section>
      {problemNotice(problem ?? queryProblem, onNavigate)}
      <RightsListView state={state} />
    </main>
  )
}
