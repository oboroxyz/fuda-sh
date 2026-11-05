import type { JSX } from 'preact'

export const FieldLabel = (props: { label: string; optional?: string }): JSX.Element => (
  <span class="flex items-center gap-2">
    <span>{props.label}</span>
    {props.optional === undefined || props.optional === '' ? null : (
      <span class="text-moderate text-xs">{props.optional}</span>
    )}
  </span>
)
