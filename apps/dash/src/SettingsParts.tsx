import type { JSX } from 'preact'

// The pieces a settings panel shows around its own fields: the failure and saved
// notices with the save button, and the placeholder shown until the first load
// answers.
export const SettingsFooter = <Failure extends string>(props: {
  busy: boolean
  copy: { save: string; saved: string; saving: string }
  error: Failure | null
  failures: Record<Failure, string>
  onSubmit: () => void
  saved: boolean
}): JSX.Element => (
  <>
    {props.error === null ? null : (
      <p class="text-error" role="alert">
        {props.failures[props.error]}
      </p>
    )}
    {props.saved ? <p role="status">{props.copy.saved}</p> : null}
    <button class="btn btn-primary self-start" disabled={props.busy} type="button" onClick={props.onSubmit}>
      {props.busy ? props.copy.saving : props.copy.save}
    </button>
  </>
)

export const SettingsLoadState = (props: {
  busy: boolean
  class: string
  copy: { failures: { load: string }; loading: string; retry: string }
  failed: boolean
  onRetry: () => void
}): JSX.Element => (
  <div class={props.class} role={props.failed ? 'alert' : 'status'}>
    <span>{props.busy ? props.copy.loading : props.copy.failures.load}</span>
    {props.failed ? (
      <button class="btn btn-sm" type="button" onClick={props.onRetry}>
        {props.copy.retry}
      </button>
    ) : null}
  </div>
)
