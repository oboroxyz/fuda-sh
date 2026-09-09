/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { APP_ORIGIN } from './config.ts'

// The member app's default entry screen (docs/specs/pass-types-and-flows.md#surfaces).
// Vocabulary is fixed by docs/CONTEXT.md — Venue for the organization,
// pass for what a member shows, two levels with +Private as an extension of
// Signed and never a third level.
const LEVELS = [
  {
    body: 'No wallet, no app. The pass sits in Apple Wallet or Google Wallet and its QR alone admits you.',
    tag: 'QR at the door',
    title: 'Bearer',
  },
  {
    body: 'Your own wallet signs a one-time challenge at the door, so possession of the key is proven on the spot.',
    tag: 'Sign at the door',
    title: 'Signed',
  },
  {
    body: 'Signed with the privacy extension on: the right is issued to a one-time address, so chain observers cannot link it to you. The challenge at the door is the same as Signed.',
    tag: 'extension of Signed',
    title: '+Private',
  },
] as const

const LINKS = [
  {
    detail: 'Scan your pass and sign at the gate.',
    href: `${APP_ORIGIN}/signed`,
    label: 'Enter with your wallet',
  },
  { detail: 'Find your private rights with your passkey.', href: `${APP_ORIGIN}/private`, label: '+Private' },
  { detail: 'Scan and verify a member’s pass.', href: 'https://gate.fuda.sh', label: 'Open the gate' },
  { detail: 'Manage your venue and its cards.', href: 'https://dash.fuda.sh', label: 'Venue dashboard' },
] as const

export const Landing = (): JSX.Element => (
  <main class="member-page flex flex-col gap-12 sm:gap-16">
    <header class="flex items-center justify-between gap-4 border-b border-[var(--fuda-border)] pb-5">
      <span class="font-display text-3xl font-bold">fuda</span>
      <a class="btn btn-outline" href={`${APP_ORIGIN}/rights`}>
        Your passes <span aria-hidden="true">↗</span>
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
        A venue issues your pass. You keep it with you and show it at the gate. Your membership right lives
        on-chain, where it can be verified.
      </p>
      <a class="btn btn-primary" href={`${APP_ORIGIN}/rights`}>
        Open your passes <span aria-hidden="true">→</span>
      </a>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold">Two levels</h2>
      <p class="max-w-xl text-sm leading-relaxed text-[var(--fuda-muted)]">
        A Venue picks the level when it issues your pass, and the level is fixed for that pass.
      </p>
      <div class="grid gap-4 md:grid-cols-3">
        {LEVELS.map((level): JSX.Element => (
          <article class="card member-pass" key={level.title}>
            <div class="card-body gap-3">
              <h3 class="card-title">{level.title}</h3>
              <span class="badge badge-ghost badge-sm">{level.tag}</span>
              <p class="text-sm leading-relaxed text-[var(--fuda-muted)]">{level.body}</p>
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
