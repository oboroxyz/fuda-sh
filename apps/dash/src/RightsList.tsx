/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import type { MemberRowView } from './members-view.ts'
import { QrBlock } from './QrBlock.tsx'

export interface RightsListProps {
  copy: DashCopy['rights']
  openQr: string | null
  onRequestRevoke: (row: MemberRowView, invoker: HTMLButtonElement) => void
  onToggleQr: (uid: string) => void
  revokingUid: string | null
  rows: readonly MemberRowView[]
}

type RightsLayout = 'table' | 'cards'

const qrPanelId = (layout: RightsLayout, uid: string): string => `right-${layout}-qr-${uid}`

const shortenedUid = (uid: string): string => `${uid.slice(0, 10)}…`

const levelLabel = (copy: DashCopy['rights'], row: MemberRowView): string => {
  if (row.level === 'private') {
    return copy.private
  }
  if (row.level === 'signed') {
    return copy.signed
  }
  return copy.bearer
}

const displayValue = (value: string): JSX.Element | string =>
  value === '' ? <span class="opacity-50">—</span> : value

const statusBadge = (copy: DashCopy['rights'], row: MemberRowView): JSX.Element => (
  <span class={`badge ${row.status === 'active' ? 'badge-success' : 'badge-error'}`}>
    {row.status === 'active' ? copy.active : copy.revoked}
  </span>
)

const passLinks = (copy: DashCopy['rights'], row: MemberRowView): JSX.Element => {
  if (row.passUrls === null) {
    return <span class="opacity-50">—</span>
  }
  return (
    <span class="flex gap-2 text-xs">
      <a class="link" href={row.passUrls.web} target="_blank" rel="noreferrer">
        {copy.web}
      </a>
      <a class="link" href={row.passUrls.google} target="_blank" rel="noreferrer">
        {copy.google}
      </a>
      <a class="link" href={row.passUrls.apple} target="_blank" rel="noreferrer">
        {copy.apple}
      </a>
    </span>
  )
}

const uidDisplay = (row: MemberRowView): JSX.Element => (
  <code class="text-xs" title={row.uid}>
    <span class="sr-only">{row.uid}</span>
    <span aria-hidden="true">{shortenedUid(row.uid)}</span>
  </code>
)

const qrDisclosure = (layout: RightsLayout, openQr: string | null, row: MemberRowView): JSX.Element | null =>
  openQr === row.uid ? (
    <div id={qrPanelId(layout, row.uid)} class="pt-3">
      <QrBlock qr={row.qr} />
    </div>
  ) : null

const actions = ({
  copy,
  onRequestRevoke,
  onToggleQr,
  openQr,
  revokingUid,
  row,
  layout,
}: RightsListProps & { layout: RightsLayout; row: MemberRowView }): JSX.Element => {
  const qrOpen = openQr === row.uid
  const revokeDisabled = row.status === 'revoked' || revokingUid === row.uid
  return (
    <div class="flex gap-2">
      <button
        type="button"
        class="btn btn-xs"
        aria-controls={qrPanelId(layout, row.uid)}
        aria-expanded={qrOpen}
        onClick={() => {
          onToggleQr(row.uid)
        }}
      >
        {qrOpen ? copy.hideQr : copy.qr}
      </button>
      <button
        type="button"
        class="btn btn-xs btn-error"
        disabled={revokeDisabled}
        onClick={(event) => {
          if (event.currentTarget instanceof HTMLButtonElement) {
            onRequestRevoke(row, event.currentTarget)
          }
        }}
      >
        {copy.revoke}
      </button>
    </div>
  )
}

const tableRecord = (props: RightsListProps, row: MemberRowView): JSX.Element[] =>
  [
    <tr key={row.uid} data-right-uid={row.uid}>
      <td>{displayValue(row.memberId)}</td>
      <td>{row.holderShort ?? <span class="opacity-50">—</span>}</td>
      <td>
        <span class="badge">{levelLabel(props.copy, row)}</span>
      </td>
      <td>{row.tier}</td>
      <td>{statusBadge(props.copy, row)}</td>
      <td>{uidDisplay(row)}</td>
      <td>{passLinks(props.copy, row)}</td>
      <td>{actions({ ...props, layout: 'table', row })}</td>
    </tr>,
    props.openQr === row.uid ? (
      <tr key={`${row.uid}:qr`}>
        <td colspan={8}>{qrDisclosure('table', props.openQr, row)}</td>
      </tr>
    ) : null,
  ].filter((record): record is JSX.Element => record !== null)

const cardRecord = (props: RightsListProps, row: MemberRowView): JSX.Element => (
  <article class="card bg-base-200 gap-3 p-4" data-right-uid={row.uid}>
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="font-medium">{displayValue(row.memberId)}</p>
        <p class="text-xs opacity-70">{row.holderShort ?? '—'}</p>
      </div>
      {statusBadge(props.copy, row)}
    </div>
    <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      <div>
        <dt class="opacity-70">{props.copy.level}</dt>
        <dd>{levelLabel(props.copy, row)}</dd>
      </div>
      <div>
        <dt class="opacity-70">{props.copy.tier}</dt>
        <dd>{row.tier}</dd>
      </div>
      <div>
        <dt class="opacity-70">{props.copy.uid}</dt>
        <dd>{uidDisplay(row)}</dd>
      </div>
      <div>
        <dt class="opacity-70">{props.copy.passes}</dt>
        <dd>{passLinks(props.copy, row)}</dd>
      </div>
    </dl>
    {actions({ ...props, layout: 'cards', row })}
    {qrDisclosure('cards', props.openQr, row)}
  </article>
)

export const RightsList = (props: RightsListProps): JSX.Element => (
  <>
    <div data-testid="rights-table" class="hidden lg:block">
      <div class="overflow-x-auto">
        <table class="table-zebra table">
          <thead>
            <tr>
              <th>{props.copy.member}</th>
              <th>{props.copy.holder}</th>
              <th>{props.copy.level}</th>
              <th>{props.copy.tier}</th>
              <th>{props.copy.status}</th>
              <th>{props.copy.uid}</th>
              <th>{props.copy.passes}</th>
              <th class="sr-only">{props.copy.revoke}</th>
            </tr>
          </thead>
          <tbody>{props.rows.flatMap((row) => tableRecord(props, row))}</tbody>
        </table>
      </div>
    </div>
    <div data-testid="rights-cards" class="flex flex-col gap-3 lg:hidden">
      {props.rows.map((row): JSX.Element => cardRecord(props, row))}
    </div>
  </>
)
