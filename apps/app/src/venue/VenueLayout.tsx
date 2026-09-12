/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { FudaMark } from '@fuda/ui'
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
      <a
        href={`/@${handle}?cards=all`}
        class="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-[var(--fuda-muted)]"
      >
        <span aria-hidden="true" class="text-base">
          ←
        </span>
        {pick(VENUE_COPY, locale).backToCards}
      </a>
      <FudaMark class="size-8 shrink-0 text-[var(--fuda-muted)]" />
    </header>
    <div class="venue-content">{children}</div>
  </main>
)
