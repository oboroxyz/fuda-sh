/** @jsxImportSource hono/jsx/dom */
import { cn } from 'cn'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

export interface IconButtonProps {
  class?: string
  children: JSX.Element
  label: string
  onClick: () => void
}

export const IconButton = ({ children, class: className, label, onClick }: IconButtonProps): JSX.Element => (
  <button aria-label={label} class={cn('fuda-icon-button', className)} onClick={onClick} type="button">
    {children}
  </button>
)
