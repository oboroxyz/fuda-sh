/** @jsxImportSource hono/jsx/dom */
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { DASH_COPY } from './copy.ts'
import type { MemberRowView } from './members-view.ts'
import { QrBlock } from './QrBlock.tsx'

const PassLinks = ({ row }: { row: MemberRowView }): JSX.Element => {
  // Private rows hand out no pass: the member discovers the right in their app.
  if (row.passUrls === null) {
    return <span class="opacity-50">—</span>
  }
  return (
    <span class="flex gap-2 text-xs">
      <a class="link" href={row.passUrls.web} target="_blank" rel="noreferrer">
        web
      </a>
      <a class="link" href={row.passUrls.google} target="_blank" rel="noreferrer">
        google
      </a>
      <a class="link" href={row.passUrls.apple} target="_blank" rel="noreferrer">
        apple
      </a>
    </span>
  )
}

export const MembersTable = ({
  rows,
  onRevoke,
}: {
  rows: MemberRowView[]
  onRevoke: (uid: string) => void
}): JSX.Element => {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <table class="table-zebra table">
      <thead>
        <tr>
          <th>member</th>
          <th>level</th>
          <th>tier</th>
          <th>status</th>
          <th>uid</th>
          <th>pass</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.flatMap((r): (JSX.Element | null)[] => [
          <tr key={r.uid}>
            <td>
              {r.memberId === '' ? <span class="opacity-50">—</span> : r.memberId}
              {r.holderShort === null ? null : <div class="text-xs opacity-60">{r.holderShort}</div>}
            </td>
            <td>
              <span class="badge">{r.level}</span>
            </td>
            <td>{r.tier}</td>
            <td>
              <span class={`badge ${r.status === 'active' ? 'badge-success' : 'badge-error'}`}>
                {r.status}
              </span>
            </td>
            <td>
              <code class="text-xs">{`${r.uid.slice(0, 10)}…`}</code>
            </td>
            <td>
              <PassLinks row={r} />
            </td>
            <td>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="btn btn-xs"
                  onClick={() => {
                    setOpen(open === r.uid ? null : r.uid)
                  }}
                >
                  QR
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-error"
                  disabled={r.status === 'revoked'}
                  onClick={() => {
                    onRevoke(r.uid)
                  }}
                >
                  Revoke
                </button>
              </div>
            </td>
          </tr>,
          open === r.uid ? (
            <tr key={`${r.uid}:qr`}>
              <td colspan={7}>
                <QrBlock label={DASH_COPY.en.rights.qrLabel} qr={r.qr} />
              </td>
            </tr>
          ) : null,
        ])}
      </tbody>
    </table>
  )
}
