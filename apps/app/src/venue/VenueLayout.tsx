import { FudaMark } from '@fuda/ui'
import type { JSX } from 'solid-js'

export const VenueLayout = (props: { children: JSX.Element }): JSX.Element => (
  <main class="venue-page">
    <header class="venue-header">
      <FudaMark class="size-8 shrink-0 text-[var(--fuda-muted)]" />
    </header>
    <div class="venue-content">{props.children}</div>
  </main>
)
