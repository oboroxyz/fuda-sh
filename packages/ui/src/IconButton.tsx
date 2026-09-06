/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

export interface IconButtonProps {
  children: JSX.Element
  label: string
  onClick: () => void
}

export const IconButton = ({ children, label, onClick }: IconButtonProps): JSX.Element => (
  <button aria-label={label} class="fuda-icon-button" onClick={onClick} type="button">
    {children}
  </button>
)
