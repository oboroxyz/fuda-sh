import type { CardApplicantsResponse, CardView } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchCardApplicants } from './api.ts'
import { CHAIN } from './config.ts'
import type { DashCopy } from './copy.ts'
import { settled } from './network-result.ts'
import { useCopyText } from './use-copy-text.ts'

export const CardRequirements = (props: { card: CardView; copy: DashCopy }): JSX.Element => (
  <section class="card dash-no-print flex min-w-0 flex-col gap-3 p-5">
    <h2 class="text-lg font-semibold">{props.copy.requirements.title}</h2>
    {props.card.requirements?.map((requirement) => (
      <dl key={`${requirement.registry}/${requirement.assetId}`} class="flex min-w-0 flex-col gap-2 text-sm">
        <dt>{props.copy.designer.requirementRegistry}</dt>
        <dd class="font-mono break-all">
          <a
            class="link"
            href={`${CHAIN.explorerUrl}/address/${requirement.registry}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {requirement.registry}
          </a>
        </dd>
        <dt>{props.copy.designer.requirementAsset}</dt>
        <dd class="font-mono break-all">
          <a
            class="link"
            href={`${CHAIN.explorerUrl}/address/${requirement.registry}#readContract`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {requirement.assetId}
          </a>
        </dd>
        {requirement.termsId === undefined ? null : (
          <>
            <dt>{props.copy.requirements.terms}</dt>
            <dd class="font-mono break-all">{requirement.termsId}</dd>
          </>
        )}
      </dl>
    ))}
    <p class="text-sm">{props.copy.designer.identityAddressHint}</p>
    <p class="text-sm">{props.copy.designer.requirementFixed}</p>
  </section>
)

export type LoadApplicants = (cardId: string, after?: string) => Promise<Result<CardApplicantsResponse>>

const useApplicants = (props: { cardId: string; copy: DashCopy; load?: LoadApplicants }) => {
  const [page, setPage] = useState<CardApplicantsResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const generation = useRef(0)
  const load = (after?: string): void => {
    if (pending.current) {
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    const ticket = generation.current
    const run = async (): Promise<void> => {
      const result = await settled(async () => await (props.load ?? fetchCardApplicants)(props.cardId, after))
      if (generation.current !== ticket) {
        return
      }
      pending.current = false
      setBusy(false)
      if (result.ok) {
        setPage((previous) => ({
          applicants: [
            ...(after === undefined ? [] : (previous?.applicants ?? [])),
            ...result.body.applicants,
          ],
          next: result.body.next,
        }))
      } else {
        setError(result.error)
      }
    }
    void run()
  }
  useEffect(() => {
    generation.current += 1
    pending.current = false
    setPage(null)
    load()
    return () => {
      generation.current += 1
    }
  }, [props.cardId])
  return { busy, error, load, page }
}

export const CardApplicants = (props: {
  cardId: string
  copy: DashCopy
  load?: LoadApplicants
}): JSX.Element => {
  const { page, busy, error, load } = useApplicants(props)
  const clipboard = useCopyText()
  const labels = props.copy.requirements
  return (
    <section class="card dash-no-print flex min-w-0 flex-col gap-3 p-5">
      <h2 class="text-lg font-semibold">{labels.applicants}</h2>
      <p class="text-sm">{labels.warning}</p>
      {page?.applicants.length === 0 ? <p>{labels.empty}</p> : null}
      <ul class="flex flex-col gap-4">
        {page?.applicants.map((applicant) => (
          <li
            key={applicant.address}
            class="border-base-300 flex min-w-0 flex-col items-start gap-2 border-b pb-3"
          >
            <span class="font-mono text-sm break-all">{applicant.address}</span>
            <time class="text-sm" dateTime={new Date(applicant.appliedAt * 1000).toISOString()}>
              {labels.applied}: {new Date(applicant.appliedAt * 1000).toLocaleString(labels.dateLocale)}
            </time>
            <button
              type="button"
              class="btn btn-sm"
              onClick={() => {
                clipboard.copy(applicant.address)
              }}
            >
              {clipboard.copied === applicant.address ? labels.copied : labels.copy}
            </button>
          </li>
        ))}
      </ul>
      {clipboard.failed === null ? null : <p role="alert">{labels.copyFailed}</p>}
      {error === null ? null : <p role="alert">{props.copy.requirementsError(error)}</p>}
      {busy ? <p role="status">{labels.loading}</p> : null}
      {!busy && (error !== null || (page?.next ?? null) !== null) ? (
        <button
          type="button"
          class="btn self-start"
          onClick={() => {
            load(page?.next ?? undefined)
          }}
        >
          {error === null ? labels.more : labels.retry}
        </button>
      ) : null}
    </section>
  )
}

export const CardRequirementSections = (props: { card: CardView; copy: DashCopy }): JSX.Element | null =>
  (props.card.requirements?.length ?? 0) === 0 ? null : (
    <>
      <CardRequirements {...props} />
      <CardApplicants key={props.card.id} cardId={props.card.id} copy={props.copy} />
    </>
  )
