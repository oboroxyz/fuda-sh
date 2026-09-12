/** @jsxImportSource hono/jsx/dom */
import { FudaMark } from '@fuda/ui'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

export const VenueLayout = ({ children }: { children: JSX.Element }): JSX.Element => (
  <main class="venue-page">
    <header class="venue-header">
      <FudaMark class="size-8 shrink-0 text-[var(--fuda-muted)]" />
    </header>
    <div class="venue-content">{children}</div>
  </main>
)
