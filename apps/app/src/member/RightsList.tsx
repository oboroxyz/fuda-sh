import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { QueryClient } from '@fuda/libs/query'
import { useQuery, useQueryScope } from '@fuda/libs/query'
import { asHex, brandTextColor, fetchRightsByHolder, isPasskeyPass, normalizeUid } from '@fuda/sdk'
import type { Hex, PassCardView } from '@fuda/sdk'
import { short } from '@fuda/ui/short'
import { Fragment } from 'preact'
import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import { fetchPassCard, fetchStampSummary, verifyUid } from '../api.ts'
import { API_BASE_URL, GRAPH_RIGHTS_ENDPOINT } from '../config.ts'
import {
  applePassAvailable,
  connectMemberRail,
  googlePassHref,
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
import { SensitivePasses } from './SensitivePasses.tsx'

type MemberListState =
  | { kind: 'idle' }
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

const listView = (state: MemberListState, locale: Locale, search: string): JSX.Element => {
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
          {rows.map((row) => (
            <Fragment key={row.uid}>{memberCard(row, locale, copy)}</Fragment>
          ))}
        </ul>
      )}
    </>
  )
}

export const RightsListView = (props: {
  search?: string
  state: MemberListState
  locale?: Locale
}): JSX.Element => <>{listView(props.state, props.locale ?? DEFAULT_LOCALE, props.search ?? '')}</>

type MemberProblem = Error | 'connectionFailed' | 'invalidAddress'

const problemNotice = (problem: MemberProblem | null, locale: Locale): JSX.Element | null => {
  if (problem === null) {
    return null
  }
  if (problem === 'invalidAddress' || problem === 'connectionFailed') {
    return <div class="alert alert-error">{pick(MEMBER_COPY, locale).passes[problem]}</div>
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
}

const queryUidFromLocation = (): Hex | null => {
  if (import.meta.env.SSR) {
    return null
  }
  const raw = new URLSearchParams(location.search).get('uid')
  return raw === null ? null : normalizeUid(raw)
}

const memberQueryProblem = (
  query: {
    data: MemberPassListResult | undefined
    error: Error | null
    recoveryError: Error | null
  },
  copy: MemberCopy,
): MemberProblem | null => {
  if (query.recoveryError !== null) {
    return new Error(`${copy.passes.recoveryFailed} ${query.recoveryError.message}`)
  }
  return query.data === undefined ? null : query.error
}

const HolderLookup = (props: {
  copy: MemberCopy
  injected: Eip1193Provider | null
  manual: string
  onConnect: (open: () => Promise<Eip1193Provider>) => Promise<void>
  onLookup: () => void
  onManual: (value: string) => void
}): JSX.Element => {
  const { injected } = props
  return (
    <div class="flex flex-col gap-4">
      {injected === null ? null : (
        <button
          class="btn"
          type="button"
          onClick={() => {
            void props.onConnect(async () => await Promise.resolve(injected))
          }}
        >
          {props.copy.passes.browserWallet}
        </button>
      )}
      <form
        class="flex max-w-xl flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          props.onLookup()
        }}
      >
        <input
          class="input input-bordered grow font-mono"
          aria-label={props.copy.passes.address}
          placeholder={props.copy.passes.placeholder}
          value={props.manual}
          onInput={(event) => {
            props.onManual(event.currentTarget.value)
          }}
        />
        <button class="btn" type="submit">
          {props.copy.passes.lookup}
        </button>
      </form>
    </div>
  )
}

const usePassMemorySync = (
  recovered: PassMemoryEntry | null | undefined,
  syncWithAccount: boolean,
  memory: PassMemoryEntry[],
  setMemory: (entries: PassMemoryEntry[]) => void,
): void => {
  useEffect(() => {
    if (recovered !== undefined && recovered !== null) {
      setMemory(rememberPass(recovered))
    }
  }, [recovered])

  useEffect(() => {
    if (!syncWithAccount) {
      return
    }
    let current = true
    void (async () => {
      const fresh = await syncMemberPasses(memory)
      if (current) {
        for (const pass of fresh) {
          setMemory(rememberPass(pass))
        }
      }
    })()
    return () => {
      current = false
    }
  }, [])
}

const useHolderLookup = () => {
  const [addresses, setAddresses] = useState<Hex[]>([])
  const [manual, setManual] = useState('')
  const [problem, setProblem] = useState<MemberProblem | null>(null)
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
    const holder = asHex(manual.trim(), 20)
    if (holder === null) {
      setProblem('invalidAddress')
      return
    }
    setProblem(null)
    addAddress(holder)
  }

  return { addresses, connect, lookup, manual, problem, setManual }
}

const LIST_LAYOUTS = {
  lookup: { class: 'flex flex-col gap-4', tag: 'section' },
  passes: { class: 'member-page flex flex-col gap-6', tag: 'main' },
} satisfies Record<'lookup' | 'passes', { class: string; tag: 'main' | 'section' }>

const initialPassMemory = (memory: readonly PassMemoryEntry[] | undefined): PassMemoryEntry[] => {
  if (import.meta.env.SSR) {
    return []
  }
  return [...(memory ?? readPassMemory())]
}

export const RightsList = (props: RightsListProps): JSX.Element => {
  const { variant = 'passes', locale = DEFAULT_LOCALE, io = defaultIo, injected = injectedProvider() } = props
  const copy = pick(MEMBER_COPY, locale)
  const { addresses, connect, lookup, manual, problem, setManual } = useHolderLookup()
  const localQueryClient = useQueryScope()
  const queryClient = props.queryClient ?? localQueryClient
  const [memory, setMemory] = useState(() => initialPassMemory(props.memory))
  const [search, setSearch] = useState('')
  const [locationUid] = useState(queryUidFromLocation)
  const uid = props.queryUid === undefined ? locationUid : props.queryUid
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
  const queryProblem = memberQueryProblem(
    { data: listQuery.data, error: listQuery.error, recoveryError: recoveryQuery.error },
    copy,
  )

  usePassMemorySync(recoveryQuery.data, props.syncWithAccount === true, memory, setMemory)

  const visibleState: MemberListState =
    variant === 'lookup' && addresses.length === 0
      ? { kind: 'idle' }
      : memberListState(listQuery.data, listQuery.error)
  const controls =
    variant === 'passes' ? (
      <>
        <h1 class="member-heading">{copy.nav.rights}</h1>
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
            aria-label={copy.passes.search}
            placeholder={copy.passes.search}
            value={search}
            onInput={(event) => {
              setSearch(event.currentTarget.value)
            }}
          />
        </div>
      </>
    ) : (
      <HolderLookup
        copy={copy}
        injected={injected}
        manual={manual}
        onConnect={connect}
        onLookup={lookup}
        onManual={setManual}
      />
    )
  const layout = LIST_LAYOUTS[variant]
  const Container = layout.tag
  return (
    <Container class={layout.class}>
      {controls}
      {problemNotice(problem ?? queryProblem, locale)}
      <RightsListView locale={locale} state={visibleState} search={search} />
      {props.syncWithAccount === true ? <SensitivePasses locale={locale} /> : null}
    </Container>
  )
}
