/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { VENUE_COPY } from './copy.ts'

export const VenueLayout = ({
  handle,
  children,
  locale = DEFAULT_LOCALE,
}: {
  handle: string
  children: JSX.Element
  locale?: Locale
}): JSX.Element => (
  <main class="venue-page">
    <header class="venue-header">
      <a href={`/@${handle}`} class="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
        <span aria-hidden="true">←</span>
        {pick(VENUE_COPY, locale).backToCards}
      </a>
      <span class="text-xs tracking-widest text-[var(--fuda-muted)]">fuda</span>
    </header>
    <div class="venue-content">{children}</div>
  </main>
)
