import { FudaMark } from '@fuda/ui-preact'
import type { ComponentChildren, JSX } from 'preact'

export const VenueLayout = (props: { children?: ComponentChildren }): JSX.Element => (
  <main class="venue-page">
    <header class="venue-header">
      <FudaMark class="size-8 shrink-0 text-[var(--fuda-muted)]" />
    </header>
    <div class="venue-content">{props.children}</div>
  </main>
)
