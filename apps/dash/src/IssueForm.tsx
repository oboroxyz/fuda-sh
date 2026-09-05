/** @jsxImportSource hono/jsx/dom */
import { TIER_LABEL, USAGE_MODEL } from '@fuda/sdk'
import type { IssueResponse } from '@fuda/sdk'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { Result } from './api.ts'
import { issueBodyFrom } from './issue-form.ts'
import type { IssueForm as Form } from './issue-form.ts'
import { QrBlock } from './QrBlock.tsx'

const USAGE = [
  { label: 'SINGLE_USE', value: USAGE_MODEL.SINGLE_USE },
  { label: 'MULTI_USE', value: USAGE_MODEL.MULTI_USE },
  { label: 'METERED', value: USAGE_MODEL.METERED },
] as const

const LEVELS: readonly Form['level'][] = ['bearer', 'signed', 'private']

const isLevel = (s: string): s is Form['level'] => LEVELS.some((l) => l === s)

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : null

// The api's error code is shown verbatim: Signed and +Private answer bad_input
// until those levels land, and the operator should see exactly what it said.
const Outcome = ({ result }: { result: Result<IssueResponse> }): JSX.Element => {
  if (!result.ok) {
    return <div class="alert alert-error">{result.error}</div>
  }
  if (result.body.level === 'private') {
    return (
      <div class="alert alert-success">
        announced — member discovers it in their app · tx {result.body.announceTx.slice(0, 10)}…
      </div>
    )
  }
  return (
    <div class="flex flex-col items-start gap-2">
      <div class="alert alert-success">
        issued {result.body.level} · holder {result.body.holder}
      </div>
      <QrBlock qr={result.body.qr} />
      <a class="link text-sm" href={result.body.passUrls.web} target="_blank" rel="noreferrer">
        open browser-based pass
      </a>
    </div>
  )
}

export const IssueForm = ({
  onIssue,
}: {
  onIssue: (body: Record<string, string | number>) => Promise<Result<IssueResponse>>
}): JSX.Element => {
  const [form, setForm] = useState<Form>({
    holder: '',
    level: 'bearer',
    memberId: '',
    stealthMetaAddress: '',
    tier: 1,
    usageModel: 1,
  })
  const [result, setResult] = useState<Result<IssueResponse> | null>(null)
  const set = (patch: Partial<Form>): void => {
    setForm({ ...form, ...patch })
  }
  const onText =
    (patch: (v: string) => Partial<Form>) =>
    (e: Event): void => {
      const v = fieldValue(e.currentTarget)
      if (v !== null) {
        set(patch(v))
      }
    }
  const body = issueBodyFrom(form)
  const submit = async (b: Record<string, string | number>): Promise<void> => {
    setResult(await onIssue(b))
  }
  return (
    <form
      class="card bg-base-200 flex max-w-xl flex-col gap-3 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (body !== null) {
          void submit(body)
        }
      }}
    >
      <h2 class="text-lg font-bold">Issue a right</h2>
      <select class="select" value={form.level} onChange={onText((v) => (isLevel(v) ? { level: v } : {}))}>
        <option value="bearer">Bearer — Device wallet pass, no app</option>
        <option value="signed">Signed — the member's own wallet signs at the gate</option>
        <option value="private">+Private — stealth address from a meta-address</option>
      </select>
      <p class="text-xs opacity-60">
        Signed and +Private submit today, but the api answers 400 bad_input until those levels land; the error
        is shown below verbatim.
      </p>
      {form.level === 'bearer' ? (
        <input
          class="input"
          placeholder="memberId (e.g. alice)"
          value={form.memberId}
          onInput={onText((v) => ({ memberId: v }))}
        />
      ) : null}
      {form.level === 'signed' ? (
        <input
          class="input font-mono"
          placeholder="holder 0x…40 hex"
          value={form.holder}
          onInput={onText((v) => ({ holder: v }))}
        />
      ) : null}
      {form.level === 'private' ? (
        <>
          <input
            class="input font-mono"
            placeholder="stealth meta-address 0x…132 hex"
            value={form.stealthMetaAddress}
            onInput={onText((v) => ({ stealthMetaAddress: v }))}
          />
          <input
            class="input"
            placeholder="memberId (optional representative id)"
            value={form.memberId}
            onInput={onText((v) => ({ memberId: v }))}
          />
        </>
      ) : null}
      <div class="flex gap-3">
        <select class="select" value={String(form.tier)} onChange={onText((v) => ({ tier: Number(v) }))}>
          {TIER_LABEL.map((label, i): JSX.Element => (
            <option key={label} value={String(i)}>
              {label}
            </option>
          ))}
        </select>
        <select
          class="select"
          value={String(form.usageModel)}
          onChange={onText((v) => ({ usageModel: Number(v) }))}
        >
          {USAGE.map((u): JSX.Element => (
            <option key={u.label} value={String(u.value)}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <button class="btn btn-primary" type="submit" disabled={body === null}>
        Issue
      </button>
      {result === null ? null : <Outcome result={result} />}
    </form>
  )
}
