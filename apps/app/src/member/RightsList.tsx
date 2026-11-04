import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { QueryClient } from '@fuda/libs/query'
import { createQuery, createQueryScope } from '@fuda/libs/query'
import { asHex, brandTextColor, fetchRightsByHolder, isPasskeyPass, normalizeUid } from '@fuda/sdk'
import type { GraphRight, Hex, PassCardView } from '@fuda/sdk'
import { short } from '@fuda/ui'
import { createEffect, createSignal, For, on, onMount } from 'solid-js'
import type { JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'

import { fetchPassCard, fetchStampSummary, verifyUid } from '../api.ts'
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
import { syncMemberPasses } from '../member-pass-sync.ts'
import { passBackupHref } from '../pass-backup.ts'
import { readPassMemory, rememberPass } from '../pass-memory.ts'
import type { PassMemoryEntry } from '../pass-memory.ts'
import { injectedProvider, requestAccount } from '../wallet.ts'
import type { Eip1193Provider } from '../wallet.ts'
import { MEMBER_COPY, PASS_REASON_JA } from './copy.ts'
import type { MemberCopy } from './copy.ts'

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

const graphCard = (right: GraphRight, copy: MemberCopy['passes']): JSX.Element => (
  <li class="card member-pass">
    <div class="card-body gap-2">
      <div class={right.revokedAt === null ? 'badge badge-success' : 'badge badge-error'}>
        {right.revokedAt === null ? copy.active : copy.revoked}
      </div>
      <div class="font-mono text-xs break-all">{right.id}</div>
      <div class="text-sm">
        {copy.issuer} {short(right.issuer)}
      </div>
      <div class="text-sm">
        {copy.tier} {right.tier}
      </div>
      <div class="text-sm">
        {copy.usage} {right.usageModel}
      </div>
      {metaUri(right.metaURI)}
    </div>
  </li>
)

const memberStatus = (row: MemberPassRow, locale: Locale, copy: MemberCopy['passes']): string => {
  if (row.preview === null) {
    return copy.unavailable
  }
  if (row.preview.decision === 'ADMIT') {
    return copy.active
  }
  return locale === 'ja' ? PASS_REASON_JA[row.preview.reason] : row.preview.reason
}

const answersToPasskey = (row: MemberPassRow): boolean => {
  const entitlement = row.preview?.entitlement
  return entitlement !== undefined && isPasskeyPass(entitlement)
}

const memberPassLinks = (
  row: MemberPassRow,
  publicPass: boolean,
  copy: MemberCopy['passes'],
): JSX.Element | null => {
  if (!publicPass) {
    return null
  }
  if (answersToPasskey(row)) {
    return (
      <span class="flex items-center gap-3">
        <a class="link" download={`fuda-pass-${row.uid.slice(2, 10)}.json`} href={passBackupHref(row.uid)}>
          {copy.saveBackup}
        </a>
        <a class="btn btn-primary btn-sm" href={`/signed?uid=${row.uid}`}>
          {copy.enter}
        </a>
      </span>
    )
  }
  return (
    <span class="flex items-center gap-3">
      <a class="link" download={`fuda-pass-${row.uid.slice(2, 10)}.json`} href={passBackupHref(row.uid)}>
        {copy.saveBackup}
      </a>
      <a class="link" href={row.passes.web} target="_blank" rel="noreferrer">
        {copy.view}
      </a>
    </span>
  )
}

const hasPublicPass = (row: MemberPassRow): boolean =>
  [row.preview?.entitlement?.level, row.graph?.level].some((level) => level === 0 || level === 1)

// The plain fuda face: an admin-issued right, or a card the api could not
// describe right now. The palette is drawn from the uid so the list stays
// varied without a venue behind it.
const plainFace = (row: MemberPassRow, copy: MemberCopy['passes']): JSX.Element => {
  const name = row.preview?.delegation?.name ?? row.graph?.delegation?.name ?? ''
  return (
    <div class="member-pass-preview" data-palette={Number.parseInt(row.uid.slice(2, 4), 16) % 3}>
      <div class="flex items-center justify-between gap-4">
        <span class="font-display text-xl font-bold">fuda</span>
        <span class="text-xs font-semibold tracking-widest uppercase">{copy.pass}</span>
      </div>
      <div class="flex flex-col gap-2">
        <h2 class="text-2xl leading-tight font-bold">{name === '' ? copy.pass : name}</h2>
        <span class="font-mono text-xs">UID {short(row.uid)}</span>
      </div>
    </div>
  )
}

// The venue's face: the same colour, mark, title and member number as the
// card page and the wallet passes. Inline colours override the palette classes.
const venueFace = (card: PassCardView, copy: MemberCopy['passes']): JSX.Element => (
  <div
    class="member-pass-preview"
    style={{ 'background-color': card.brandColor, color: brandTextColor(card.brandColor) }}
  >
    <div class="flex items-center gap-3">
      {card.logoUrl === null ? null : (
        <img
          alt=""
          class="size-10 flex-none rounded-xl bg-white/10 object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
          src={card.logoUrl}
        />
      )}
      <span class="min-w-0 text-sm font-semibold">{card.issuerName}</span>
    </div>
    <div class="flex flex-col gap-2">
      <h2 class="text-2xl leading-tight font-bold">{card.cardTitle}</h2>
      <div class="text-[0.625rem] font-semibold tracking-[0.16em] uppercase">
        {copy.holder[card.category]}
      </div>
      <span class="font-mono text-lg tracking-wide">{card.memberNumber}</span>
    </div>
  </div>
)

const memberCard = (row: MemberPassRow, locale: Locale, copy: MemberCopy['passes']): JSX.Element => {
  const publicPass = hasPublicPass(row)
  const status = memberStatus(row, locale, copy)
  return (
    <li class="min-w-0">
      {row.card === null ? plainFace(row, copy) : venueFace(row.card, copy)}
      <div class="member-pass-actions">
        <div class={row.preview?.decision === 'ADMIT' ? 'badge badge-success' : 'badge badge-error'}>
          {status}
        </div>
        {memberPassLinks(row, publicPass, copy)}
      </div>
      {row.graph === null ? <p class="text-xs text-[var(--fuda-muted)]">{copy.saved}</p> : null}
      {answersToPasskey(row) ? <p class="mt-1 text-xs text-[var(--fuda-muted)]">{copy.passkeyPass}</p> : null}
      {row.stamps?.enabled === true ? (
        <div class="mt-2 text-sm" aria-label={copy.stamps}>
          <div class="font-semibold">{copy.stampCount(row.stamps.total, row.stamps.goal)}</div>
          <div class="text-[var(--fuda-muted)]">
            {copy.todayCount(row.stamps.today, row.stamps.dailyLimit)}
          </div>
        </div>
      ) : null}
    </li>
  )
}

const listView = (state: RightsListState | MemberListState, locale: Locale, search: string): JSX.Element => {
  const copy = pick(MEMBER_COPY, locale).passes
  if (state.kind === 'idle') {
    return <p class="text-sm opacity-70">{copy.idle}</p>
  }
  if (state.kind === 'loading') {
    return (
      <p class="member-empty flex items-center justify-center gap-3" role="status">
        <span class="loading loading-spinner loading-sm" aria-hidden="true" />
        {copy.loading}
      </p>
    )
  }
  if (state.kind === 'error') {
    return <div class="alert alert-error">{state.message}</div>
  }
  if ('rights' in state) {
    if (state.rights.length === 0) {
      return <p class="member-empty">{copy.noRights}</p>
    }
    return (
      <ul class="flex flex-col gap-5">
        <For each={state.rights}>{(right) => graphCard(right, copy)}</For>
      </ul>
    )
  }
  if (state.result.rows.length === 0) {
    return (
      <>
        {state.result.indexUnavailable ? (
          <div class="alert alert-warning">{copy.indexUnavailable}</div>
        ) : null}
        <div class="member-empty">
          <p class="font-semibold text-[var(--fuda-text)]">{copy.noPasses}</p>
          <p class="mt-2">{copy.start}</p>
        </div>
      </>
    )
  }
  const term = search.normalize('NFKC').trim().toLowerCase()
  const rows = state.result.rows.filter((row) => {
    const fields = [
      row.uid,
      row.preview?.delegation?.name,
      row.graph?.delegation?.name,
      row.preview?.entitlement?.issuer,
      row.graph?.issuer,
    ]
    return fields.some((field) => field?.normalize('NFKC').toLowerCase().includes(term) === true)
  })
  return (
    <>
      {state.result.indexUnavailable ? <div class="alert alert-warning">{copy.indexUnavailable}</div> : null}
      {rows.length === 0 ? (
        <p class="member-empty" role="status">
          {copy.noMatches}
        </p>
      ) : (
        <ul class="flex flex-col gap-6">
          <For each={rows}>{(row) => memberCard(row, locale, copy)}</For>
        </ul>
      )}
    </>
  )
}

export const RightsListView = (props: {
  search?: string
  state: RightsListState | MemberListState
  locale?: Locale
}): JSX.Element => <>{listView(props.state, props.locale ?? DEFAULT_LOCALE, props.search ?? '')}</>

export const QueryRecoveryNotice = (props: {
  locale?: Locale
  onNavigate?: (path: string) => void
}): JSX.Element => {
  const copy = (): MemberCopy['passes'] => pick(MEMBER_COPY, props.locale ?? DEFAULT_LOCALE).passes
  return (
    <div class="alert alert-warning">
      {copy().privateNotice}{' '}
      <a
        class="link"
        href="/private"
        onClick={(event) => {
          const { onNavigate } = props
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
        {copy().privateRights}
      </a>
    </div>
  )
}

type MemberProblem = Error | 'connectionFailed' | 'invalidAddress'

const problemNotice = (
  problem: MemberProblem | null,
  locale: Locale,
  onNavigate?: (path: string) => void,
): JSX.Element | null => {
  if (problem === null) {
    return null
  }
  if (problem === 'invalidAddress' || problem === 'connectionFailed') {
    return <div class="alert alert-error">{pick(MEMBER_COPY, locale).passes[problem]}</div>
  }
  if (problem instanceof PrivatePassRecoveryError) {
    return <QueryRecoveryNotice locale={locale} onNavigate={onNavigate} />
  }
  return <div class="alert alert-error">{problem.message}</div>
}

const defaultIo: MemberPassListIo = {
  appleAvailable: applePassAvailable,
  card: fetchPassCard,
  fetchRights: async (holder) => await fetchRightsByHolder(GRAPH_RIGHTS_ENDPOINT, holder),
  googleHref: googlePassHref,
  stampSummary: fetchStampSummary,
  verify: verifyUid,
}

interface RightsListProps {
  variant?: 'lookup' | 'passes'
  locale?: Locale
  // Signed in: keep this device's passes on the account and bring its others here.
  syncWithAccount?: boolean
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

export const RightsList = (props: RightsListProps): JSX.Element => {
  const variant = (): 'lookup' | 'passes' => props.variant ?? 'passes'
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const copy = (): MemberCopy => pick(MEMBER_COPY, locale())
  const io = props.io ?? defaultIo
  const localQueryClient = createQueryScope()
  const queryClient = props.queryClient ?? localQueryClient
  const injected = props.injected === undefined ? injectedProvider() : props.injected
  const [addresses, setAddresses] = createSignal<Hex[]>([])
  const [memory, setMemory] = createSignal<PassMemoryEntry[]>([...(props.memory ?? readPassMemory())])
  const [manual, setManual] = createSignal('')
  const [search, setSearch] = createSignal('')
  const [problem, setProblem] = createSignal<MemberProblem | null>(null)
  const uid = props.queryUid === undefined ? queryUidFromLocation() : props.queryUid
  const listQuery = createQuery(queryClient, () =>
    memberPassListQueryOptions(
      {
        addresses: addresses(),
        apiEndpoint: API_BASE_URL,
        graphEndpoint: GRAPH_RIGHTS_ENDPOINT,
        memory: memory(),
      },
      io,
    ),
  )
  const recoveryQuery = createQuery(queryClient, () => memberPassRecoveryQueryOptions(uid, API_BASE_URL, io))
  const queryProblem = (): MemberProblem | null => {
    const recoveryError = recoveryQuery().error
    const recoveryProblem =
      recoveryError === null || recoveryError instanceof PrivatePassRecoveryError
        ? recoveryError
        : new Error(`${copy().passes.recoveryFailed} ${recoveryError.message}`)
    return recoveryProblem ?? (listQuery().data === undefined ? null : listQuery().error)
  }

  createEffect(
    on(
      () => recoveryQuery().data,
      (recovered) => {
        if (recovered !== undefined && recovered !== null) {
          setMemory(rememberPass(recovered))
        }
      },
    ),
  )

  onMount(() => {
    if (props.syncWithAccount !== true) {
      return
    }
    const run = async (): Promise<void> => {
      const fresh = await syncMemberPasses(memory())
      for (const pass of fresh) {
        setMemory(rememberPass(pass))
      }
    }
    void run()
  })

  const addAddress = (address: Hex): void => {
    setAddresses((stored) => withConnectedAddress(stored, address))
  }

  const connect = async (open: () => Promise<Eip1193Provider>): Promise<void> => {
    setProblem(null)
    try {
      addAddress(await connectMemberRail(open, requestAccount))
    } catch (error) {
      setProblem(error instanceof Error ? error : 'connectionFailed')
    }
  }

  const lookup = (): void => {
    const holder = asHex(manual().trim(), 20)
    if (holder === null) {
      setProblem('invalidAddress')
      return
    }
    setProblem(null)
    addAddress(holder)
  }

  const visibleState = (): RightsListState | MemberListState =>
    variant() === 'lookup' && addresses().length === 0
      ? { kind: 'idle' }
      : memberListState(listQuery().data, listQuery().error)
  return (
    <Dynamic
      component={variant() === 'lookup' ? 'section' : 'main'}
      class={variant() === 'lookup' ? 'flex flex-col gap-4' : 'member-page flex flex-col gap-6'}
    >
      {variant() === 'passes' ? (
        <>
          <h1 class="member-heading">{copy().nav.rights}</h1>
          <div class="relative">
            <svg
              aria-hidden="true"
              class="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-[var(--fuda-muted)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              class="member-pass-search input input-bordered w-full rounded-full!"
              type="search"
              aria-label={copy().passes.search}
              placeholder={copy().passes.search}
              value={search()}
              onInput={(event) => {
                setSearch(event.currentTarget.value)
              }}
            />
          </div>
        </>
      ) : (
        <div class="flex flex-col gap-4">
          {injected === null ? null : (
            <button
              class="btn"
              type="button"
              onClick={() => {
                void connect(async () => await Promise.resolve(injected))
              }}
            >
              {copy().passes.browserWallet}
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
              aria-label={copy().passes.address}
              placeholder={copy().passes.placeholder}
              value={manual()}
              onInput={(event) => {
                setManual(event.currentTarget.value)
              }}
            />
            <button class="btn" type="submit">
              {copy().passes.lookup}
            </button>
          </form>
        </div>
      )}
      {problemNotice(problem() ?? queryProblem(), locale(), props.onNavigate)}
      <RightsListView locale={locale()} state={visibleState()} search={search()} />
    </Dynamic>
  )
}
