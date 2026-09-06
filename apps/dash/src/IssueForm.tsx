/** @jsxImportSource hono/jsx/dom */
import { TIER_LABEL, USAGE_MODEL } from '@fuda/sdk'
import type { IssueResponse } from '@fuda/sdk'
import { useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { Result } from './api.ts'
import type { DashCopy } from './copy.ts'
import { issueBodyFrom } from './issue-form.ts'
import type { IssueForm as Form } from './issue-form.ts'
import { QrBlock } from './QrBlock.tsx'
import { createSingleFlight } from './single-flight.ts'
import type { SingleFlight } from './single-flight.ts'

export interface IssueFormProps {
  copy: DashCopy['issue']
  onIssue: (body: Record<string, string | number>) => Promise<Result<IssueResponse>>
}

export interface IssueFormViewProps {
  body: Record<string, string | number> | null
  busy: boolean
  copy: DashCopy['issue']
  form: Form
  onChange: (patch: Partial<Form>) => void
  onSubmit: () => void
  result: Result<IssueResponse> | null
}

const USAGE = [
  { label: 'SINGLE_USE', value: USAGE_MODEL.SINGLE_USE },
  { label: 'MULTI_USE', value: USAGE_MODEL.MULTI_USE },
  { label: 'METERED', value: USAGE_MODEL.METERED },
] as const

const LEVELS: readonly Form['level'][] = ['bearer', 'signed', 'private']

const isLevel = (s: string): s is Form['level'] => LEVELS.some((l) => l === s)

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : null

// The api's error code is shown verbatim so the operator sees exactly what it said.
const outcome = (copy: DashCopy['issue'], result: Result<IssueResponse>): JSX.Element => {
  if (!result.ok) {
    return <div role="alert" class="alert alert-error">{`${copy.errorPrefix}: ${result.error}`}</div>
  }
  if (result.body.level === 'private') {
    return (
      <div role="status" aria-live="polite" class="alert alert-success">
        {`${copy.announced} — ${copy.memberDiscovers} · ${copy.transaction} ${result.body.announceTx.slice(0, 10)}…`}
      </div>
    )
  }
  return (
    <div class="flex flex-col items-start gap-2">
      <div role="status" aria-live="polite" class="alert alert-success">
        {`${copy.issued} ${result.body.level} · ${copy.holder} ${result.body.holder}`}
      </div>
      <QrBlock label={copy.qrLabel} qr={result.body.qr} />
      <a class="link text-sm" href={result.body.passUrls.web} target="_blank" rel="noreferrer">
        {copy.openPass}
      </a>
    </div>
  )
}

export const IssueFormView = ({
  body,
  busy,
  copy,
  form,
  onChange,
  onSubmit,
  result,
}: IssueFormViewProps): JSX.Element => {
  const onText =
    (patch: (v: string) => Partial<Form>) =>
    (e: Event): void => {
      const v = fieldValue(e.currentTarget)
      if (v !== null) {
        onChange(patch(v))
      }
    }
  const description = {
    bearer: copy.bearerDescription,
    private: copy.privateDescription,
    signed: copy.signedDescription,
  }[form.level]
  return (
    <form
      class="card bg-base-200 flex max-w-xl flex-col gap-3 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (body !== null && !busy) {
          onSubmit()
        }
      }}
    >
      <h1 class="text-2xl font-bold">{copy.title}</h1>
      <p class="text-sm opacity-70">{copy.description}</p>
      <label for="issue-level">{copy.levelLabel}</label>
      <select
        id="issue-level"
        aria-describedby="issue-level-description"
        class="select w-full"
        value={form.level}
        onChange={onText((v) => (isLevel(v) ? { level: v } : {}))}
      >
        <option value="bearer">Bearer</option>
        <option value="signed">Signed</option>
        <option value="private">+Private</option>
      </select>
      <p id="issue-level-description" class="text-sm opacity-70">
        {description}
      </p>
      {form.level === 'bearer' ? (
        <>
          <label for="issue-member-id">{copy.memberId}</label>
          <input
            id="issue-member-id"
            class="input w-full"
            value={form.memberId}
            onInput={onText((v) => ({ memberId: v }))}
          />
        </>
      ) : null}
      {form.level === 'signed' ? (
        <>
          <label for="issue-holder">{copy.holder}</label>
          <input
            id="issue-holder"
            class="input w-full font-mono"
            placeholder="0x…"
            value={form.holder}
            onInput={onText((v) => ({ holder: v }))}
          />
        </>
      ) : null}
      {form.level === 'private' ? (
        <>
          <label for="issue-meta-address">{copy.stealthMetaAddress}</label>
          <input
            id="issue-meta-address"
            class="input w-full font-mono"
            placeholder="0x…"
            value={form.stealthMetaAddress}
            onInput={onText((v) => ({ stealthMetaAddress: v }))}
          />
          <label for="issue-member-id">{copy.memberIdOptional}</label>
          <input
            id="issue-member-id"
            class="input w-full"
            value={form.memberId}
            onInput={onText((v) => ({ memberId: v }))}
          />
        </>
      ) : null}
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-1">
          <label for="issue-tier">{copy.tier}</label>
          <select
            id="issue-tier"
            class="select w-full"
            value={String(form.tier)}
            onChange={onText((v) => ({ tier: Number(v) }))}
          >
            {TIER_LABEL.map((label, i): JSX.Element => (
              <option key={label} value={String(i)}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <label for="issue-usage">{copy.usageModel}</label>
          <select
            id="issue-usage"
            class="select w-full"
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
      </div>
      <button class="btn btn-primary" type="submit" disabled={body === null || busy}>
        {busy ? copy.submitting : copy.submit}
      </button>
      {result === null ? null : outcome(copy, result)}
    </form>
  )
}

export const IssueForm = ({ copy, onIssue }: IssueFormProps): JSX.Element => {
  const [form, setForm] = useState<Form>({
    holder: '',
    level: 'bearer',
    memberId: '',
    stealthMetaAddress: '',
    tier: 1,
    usageModel: 1,
  })
  const [result, setResult] = useState<Result<IssueResponse> | null>(null)
  const [busy, setBusy] = useState(false)
  const flight = useRef<SingleFlight<'issue'> | null>(null)
  flight.current ??= createSingleFlight<'issue'>()
  const body = issueBodyFrom(form)
  const submit = async (): Promise<void> => {
    if (body === null || flight.current === null) {
      return
    }
    const pending = flight.current.run('issue', async () => await onIssue(body))
    if (pending === null) {
      return
    }
    setBusy(true)
    setResult(null)
    try {
      setResult(await pending)
    } finally {
      setBusy(false)
    }
  }
  return (
    <IssueFormView
      body={body}
      busy={busy}
      copy={copy}
      form={form}
      onChange={(patch) => {
        setForm({ ...form, ...patch })
      }}
      onSubmit={() => {
        void submit()
      }}
      result={result}
    />
  )
}
