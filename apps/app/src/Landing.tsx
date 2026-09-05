/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { APP_ORIGIN } from './config.ts'

// The fuda.sh apex (spec §13): one static screen served by this Worker's `/`
// route. Vocabulary is fixed by docs/CONTEXT.md — Venue for the organization,
// pass for what a member shows, two levels with +Private as an extension of
// Signed and never a third level.
const LEVELS = [
  {
    body: 'No wallet, no app. The pass sits in Apple Wallet or Google Wallet and its QR alone admits you.',
    tag: 'level',
    title: 'Bearer',
  },
  {
    body: 'Your own wallet signs a one-time challenge at the door, so possession of the key is proven on the spot.',
    tag: 'level',
    title: 'Signed',
  },
  {
    body: 'Signed with the privacy extension on: the right is issued to a one-time address, so chain observers cannot link it to you. The challenge at the door is the same as Signed.',
    tag: 'extension of Signed',
    title: '+Private',
  },
] as const

const LINKS = [
  { href: `${APP_ORIGIN}/signed`, label: 'Enter with your wallet' },
  { href: 'https://gate.fuda.sh', label: 'Gate — scan at the door' },
  { href: 'https://dash.fuda.sh', label: 'Dashboard — issue and revoke' },
] as const

export const Landing = (): JSX.Element => (
  <main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-6">
    <header class="flex flex-col gap-3">
      <h1 class="text-4xl font-black">fuda</h1>
      <p class="text-lg opacity-80">
        A membership right you hold on-chain. A Venue issues you a pass; the gate reads the chain and answers
        ADMIT or REJECT. The right is the record — the pass is only how you carry it.
      </p>
    </header>

    <section class="flex flex-col gap-3">
      <h2 class="text-xl font-bold">Two levels</h2>
      <p class="text-sm opacity-70">
        A Venue picks the level when it issues your pass, and the level is fixed for that pass.
      </p>
      <div class="grid gap-4 md:grid-cols-3">
        {LEVELS.map((level): JSX.Element => (
          <article class="card bg-base-200" key={level.title}>
            <div class="card-body gap-2">
              <h3 class="card-title">{level.title}</h3>
              <span class="badge badge-ghost badge-sm">{level.tag}</span>
              <p class="text-sm opacity-80">{level.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-xl font-bold">Surfaces</h2>
      <ul class="flex flex-col gap-2">
        {LINKS.map((link): JSX.Element => (
          <li key={link.href}>
            <a class="link link-primary" href={link.href}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  </main>
)
