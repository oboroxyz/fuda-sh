/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { APP_ORIGIN } from '../config.ts'

// The public introduction describes the member's tasks; venue and gate operations
// have their own applications.
const FEATURES = [
  {
    body: 'Find passes held by your account alongside those saved on this device.',
    tag: 'Keep them handy',
    title: 'Your passes',
  },
  {
    body: 'Show your pass when you arrive. If entry needs a signature, confirm with your wallet.',
    tag: 'Ready when you arrive',
    title: 'Enter',
  },
  {
    body: 'Use a separate fuda passkey to find your private rights and enter with your own key.',
    tag: 'For private rights',
    title: '+Private',
  },
] as const

const LINKS = [
  { detail: 'Open the passes available to you.', href: `${APP_ORIGIN}/rights`, label: 'Your passes' },
  { detail: 'Scan your pass and confirm entry.', href: `${APP_ORIGIN}/signed`, label: 'Enter' },
  { detail: 'Unlock your private rights.', href: `${APP_ORIGIN}/private`, label: '+Private' },
  { detail: 'Your account and appearance.', href: `${APP_ORIGIN}/settings`, label: 'Settings' },
] as const

export const Landing = ({
  onNavigate,
  signedIn = false,
}: {
  onNavigate: (path: string) => void
  signedIn?: boolean
}): JSX.Element => {
  const internal = (event: MouseEvent, path: string): void => {
    if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      onNavigate(path)
    }
  }
  const entry = signedIn ? '/rights' : '/signin'
  return (
    <main class="member-page flex flex-col gap-12 sm:gap-16">
      <header class="flex items-center justify-between gap-4 border-b border-[var(--fuda-border)] pb-5">
        <span class="font-display text-3xl font-bold">fuda</span>
        <a
          class="btn btn-outline"
          href={`${APP_ORIGIN}${entry}`}
          onClick={(event) => {
            internal(event, entry)
          }}
        >
          {signedIn ? 'Open your passes' : 'Sign in'} <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section class="flex max-w-2xl flex-col items-start gap-6 py-2 sm:py-6">
        <p class="text-xs font-semibold tracking-widest text-[var(--fuda-muted)] uppercase">
          Membership, carried with you
        </p>
        <h1 class="text-4xl leading-[1.1] font-bold tracking-tight sm:text-6xl">
          Your membership.
          <br />
          Ready at the door.
        </h1>
        <p class="max-w-xl text-base leading-relaxed text-[var(--fuda-muted)] sm:text-lg">
          Receive a card from your venue, keep your pass close, and show it when you arrive. Sign in with Base
          to open your passes and use your own key when entry needs it.
        </p>
        <a
          class="btn btn-primary"
          href={`${APP_ORIGIN}${entry}`}
          onClick={(event) => {
            internal(event, entry)
          }}
        >
          {signedIn ? 'Open your passes' : 'Sign in with Base'} <span aria-hidden="true">→</span>
        </a>
      </section>

      <section class="flex flex-col gap-4">
        <h2 class="text-xl font-bold">For your next visit</h2>
        <p class="max-w-xl text-sm leading-relaxed text-[var(--fuda-muted)]">
          Start with a card link or QR from your venue to get your card.
        </p>
        <div class="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature): JSX.Element => (
            <article class="card member-pass" key={feature.title}>
              <div class="card-body gap-3">
                <h3 class="card-title">{feature.title}</h3>
                <span class="badge badge-ghost badge-sm">{feature.tag}</span>
                <p class="text-sm leading-relaxed text-[var(--fuda-muted)]">{feature.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section class="flex flex-col gap-4 border-t border-[var(--fuda-border)] pt-8">
        <h2 class="text-xl font-bold">Find your next step</h2>
        <ul class="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {LINKS.map((link): JSX.Element => (
            <li key={link.href}>
              <a
                class="group flex items-center justify-between gap-4 rounded-xl px-3 py-4 transition-colors hover:bg-[var(--fuda-surface)]"
                href={link.href}
                onClick={(event) => {
                  internal(event, new URL(link.href).pathname)
                }}
              >
                <span class="flex min-w-0 flex-col gap-1">
                  <span class="text-sm font-semibold">{link.label}</span>
                  <span class="text-sm text-[var(--fuda-muted)]">{link.detail}</span>
                </span>
                <span aria-hidden="true" class="shrink-0 text-[var(--fuda-muted)]">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
