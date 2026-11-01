import { TIER_LABEL, USAGE_MODEL } from '@fuda/sdk'
import type { IssueResponse } from '@fuda/sdk'
import { createMemo, createSignal, For } from 'solid-js'
import type { JSX } from 'solid-js'

import type { Result } from './api.ts'
import type { DashCopy } from './copy.ts'
import { issueBodyFrom } from './issue-form.ts'
import type { IssueForm as Form } from './issue-form.ts'
import { QrBlock } from './QrBlock.tsx'
import { createSingleFlight } from './single-flight.ts'

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

export const IssueFormView = (props: IssueFormViewProps): JSX.Element => {
  const onText =
    (patch: (v: string) => Partial<Form>) =>
    (e: Event): void => {
      const v = fieldValue(e.currentTarget)
      if (v !== null) {
        props.onChange(patch(v))
      }
    }
  const description = (): string =>
    ({
      bearer: props.copy.bearerDescription,
      private: props.copy.privateDescription,
      signed: props.copy.signedDescription,
    })[props.form.level]
  return (
    <form
      class="card bg-base-200 flex max-w-xl flex-col gap-3 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (props.body !== null && !props.busy) {
          props.onSubmit()
        }
      }}
    >
      <header class="dash-page-header mb-3">
        <h1 class="dash-page-title">{props.copy.title}</h1>
        <p class="opacity-70">{props.copy.description}</p>
      </header>
      <label for="issue-level">{props.copy.levelLabel}</label>
      <select
        id="issue-level"
        aria-describedby="issue-level-description"
        class="select w-full"
        value={props.form.level}
        onInput={onText((v) => (isLevel(v) ? { level: v } : {}))}
      >
        <option value="bearer">Bearer</option>
        <option value="signed">Signed</option>
        <option value="private">+Private</option>
      </select>
      <p id="issue-level-description" class="text-sm opacity-70">
        {description()}
      </p>
      {props.form.level === 'bearer' ? (
        <>
          <label for="issue-member-id">{props.copy.memberId}</label>
          <input
            id="issue-member-id"
            class="input w-full"
            value={props.form.memberId}
            onInput={onText((v) => ({ memberId: v }))}
          />
        </>
      ) : null}
      {props.form.level === 'signed' ? (
        <>
          <label for="issue-holder">{props.copy.holder}</label>
          <input
            id="issue-holder"
            class="input w-full font-mono"
            placeholder="0x…"
            value={props.form.holder}
            onInput={onText((v) => ({ holder: v }))}
          />
        </>
      ) : null}
      {props.form.level === 'private' ? (
        <>
          <label for="issue-meta-address">{props.copy.stealthMetaAddress}</label>
          <input
            id="issue-meta-address"
            class="input w-full font-mono"
            placeholder="0x…"
            value={props.form.stealthMetaAddress}
            onInput={onText((v) => ({ stealthMetaAddress: v }))}
          />
          <label for="issue-member-id">{props.copy.memberIdOptional}</label>
          <input
            id="issue-member-id"
            class="input w-full"
            value={props.form.memberId}
            onInput={onText((v) => ({ memberId: v }))}
          />
        </>
      ) : null}
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-1">
          <label for="issue-tier">{props.copy.tier}</label>
          <select
            id="issue-tier"
            class="select w-full"
            value={String(props.form.tier)}
            onInput={onText((v) => ({ tier: Number(v) }))}
          >
            <For each={TIER_LABEL}>{(label, i) => <option value={String(i())}>{label}</option>}</For>
          </select>
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <label for="issue-usage">{props.copy.usageModel}</label>
          <select
            id="issue-usage"
            class="select w-full"
            value={String(props.form.usageModel)}
            onInput={onText((v) => ({ usageModel: Number(v) }))}
          >
            <For each={USAGE}>{(u) => <option value={String(u.value)}>{u.label}</option>}</For>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" type="submit" disabled={props.body === null || props.busy}>
        {props.busy ? props.copy.submitting : props.copy.submit}
      </button>
      <p role="status" aria-live="polite" class="sr-only">
        {props.busy ? props.copy.submitting : ''}
      </p>
      {props.result === null ? null : outcome(props.copy, props.result)}
    </form>
  )
}

export const IssueForm = (props: IssueFormProps): JSX.Element => {
  const [form, setForm] = createSignal<Form>({
    holder: '',
    level: 'bearer',
    memberId: '',
    stealthMetaAddress: '',
    tier: 1,
    usageModel: 1,
  })
  const [result, setResult] = createSignal<Result<IssueResponse> | null>(null)
  const [busy, setBusy] = createSignal(false)
  const flight = createSingleFlight<'issue'>()
  const body = createMemo(() => issueBodyFrom(form()))
  const submit = async (): Promise<void> => {
    const current = body()
    if (current === null) {
      return
    }
    const pending = flight.run('issue', async () => await props.onIssue(current))
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
      body={body()}
      busy={busy()}
      copy={props.copy}
      form={form()}
      onChange={(patch) => {
        setForm({ ...form(), ...patch })
      }}
      onSubmit={() => {
        void submit()
      }}
      result={result()}
    />
  )
}
