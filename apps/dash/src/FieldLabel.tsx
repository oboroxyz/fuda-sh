import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

export const FieldLabel = (props: { label: string; optional?: string }): JSX.Element => (
  <span class="flex items-center gap-2">
    <span>{props.label}</span>
    <Show when={props.optional}>{(optional) => <span class="text-moderate text-xs">{optional()}</span>}</Show>
  </span>
)
