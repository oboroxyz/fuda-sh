import { cn } from 'cn'
import type { JSX } from 'preact'

export interface IconButtonProps {
  class?: string
  children: JSX.Element
  label: string
  onClick: () => void
}

export const IconButton = (props: IconButtonProps): JSX.Element => (
  <button
    aria-label={props.label}
    class={cn('fuda-icon-button', props.class)}
    onClick={() => {
      props.onClick()
    }}
    type="button"
  >
    {props.children}
  </button>
)
