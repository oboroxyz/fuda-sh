/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

export const FieldLabel = ({ label, optional }: { label: string; optional?: string }): JSX.Element => (
  <span class="flex items-center gap-2">
    <span>{label}</span>
    {optional === undefined ? null : <span class="text-moderate text-xs">{optional}</span>}
  </span>
)
