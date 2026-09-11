/** @jsxImportSource hono/jsx/dom */
import { AUTH_COPY, DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { FingerprintSimple, FudaMark } from '@fuda/ui'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { APP_ORIGIN } from '../config.ts'
import { MEMBER_COPY } from './copy.ts'

export const Landing = ({
  locale = DEFAULT_LOCALE,
  onNavigate,
  signedIn = false,
}: {
  locale?: Locale
  onNavigate: (path: string) => void
  signedIn?: boolean
}): JSX.Element => {
  const copy = pick(MEMBER_COPY, locale).landing
  const entry = signedIn ? '/rights' : '/signin'
  return (
    <main class="member-page member-page-narrow flex flex-col gap-8">
      <header class="flex flex-col items-center gap-4 border-b border-[var(--fuda-border)] pb-5">
        <div class="member-logo-intro">{FudaMark({ class: 'block h-auto w-full' })}</div>
        <span class="font-display text-3xl font-bold">fuda</span>
      </header>
      <section class="flex flex-col items-start gap-6 py-4">
        <h1 class="text-4xl leading-[1.1] font-bold tracking-tight">
          {copy.title}
          <br />
          {copy.subtitle}
        </h1>
        <p class="text-base leading-relaxed text-[var(--fuda-muted)]">{copy.description}</p>
        <a
          class="btn btn-primary w-full"
          href={`${APP_ORIGIN}${entry}`}
          onClick={(event) => {
            if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              event.preventDefault()
              onNavigate(entry)
            }
          }}
        >
          {signedIn ? null : <FingerprintSimple />}
          {signedIn ? copy.open : pick(AUTH_COPY, locale).signInWithPasskey}
        </a>
        <p class="text-sm leading-relaxed text-[var(--fuda-muted)]">{copy.start}</p>
      </section>
    </main>
  )
}
