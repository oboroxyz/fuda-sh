/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

export const VenueLayout = ({ handle, children }: { handle: string; children: JSX.Element }): JSX.Element => (
  <main class="venue-page">
    <header class="venue-header">
      <a href={`/@${handle}`} class="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
        <span aria-hidden="true">←</span>
        Back to cards
      </a>
      <span class="text-xs tracking-widest text-[var(--fuda-muted)]">fuda</span>
    </header>
    <div class="venue-content">{children}</div>
  </main>
)
