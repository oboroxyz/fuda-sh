import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import * as v from 'valibot'

import { apiRequest, createVenue } from '../support/seed.ts'

const MEMBER_NUMBER = /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{5}$/u

test('the top page offers passkey sign-in', async ({ app, screen }) => {
  await app.open('/')

  await expect(screen.getByRole('heading', /Your membership\./u)).toBeVisible()
  await expect(screen.getByRole('link', 'Sign in with Passkey')).toBeVisible()
})

// The WebAuthn library's certificate code throws when a built Worker evaluates it too
// eagerly, which only this harness runs: dev servers and the api's tests do not bundle.
test('the routes that reach the passkey verifier load in the built Worker', async () => {
  const Options = v.object({ challenge: v.string() })
  const signIn = await apiRequest('/auth/member/login/options', Options, { body: '{}', method: 'POST' })
  const gate = await apiRequest('/challenge', Options, {
    body: JSON.stringify({ uid: `0x${'ab'.repeat(32)}` }),
    method: 'POST',
  })
  expect(signIn.challenge).not.toBe('')
  expect(gate.challenge).toContain('fuda-gate:')
})

test('a member claims a card from the venue page and keeps it on reload', async ({
  app,
  browser,
  screen,
}) => {
  const venue = await createVenue()
  await app.open(`/@${venue.handle}`)

  await expect(screen.getByText(venue.name)).toBeVisible()
  await expect(screen.getByText(venue.cardTitle)).toBeVisible()
  await screen.getByRole('button', 'Get your free membership card').tap()

  const qr = screen.getByRole('img', `Your membership card QR code for ${venue.name}`)
  await expect(qr).toBeVisible()
  await expect(screen.getByText(MEMBER_NUMBER)).toBeVisible()

  await browser.reload()
  await expect(qr).toBeVisible()
  await expect(screen.getByRole('button', 'Get your free membership card')).toBeHidden()
})

test('a claim link records where the pass came from', async ({ app, screen }) => {
  const venue = await createVenue()
  await app.open(`/@${venue.handle}/${venue.cardSlug}?source=e2e-flyer`)
  await screen.getByRole('button', /^Get .*membership card$/u).tap()
  await expect(screen.getByText(MEMBER_NUMBER)).toBeVisible()

  const { passes } = await apiRequest(
    '/issuers/me/passes',
    v.object({ passes: v.array(v.object({ source: v.nullable(v.string()) })) }),
    { token: venue.operatorToken },
  )
  expect(passes.map(({ source }) => source).join(' ')).toBe('e2e-flyer')
})

test('the store display links to the card', async ({ app, screen }) => {
  const venue = await createVenue()
  await app.open(`/@${venue.handle}/home`)

  await expect(screen.getByText('Scan to get your card')).toBeVisible()
  await expect(screen.getByRole('link', /Get it on this device/u)).toBeVisible()
  await expect(screen.getByRole('button', 'Print this display')).toBeVisible()
})

test('an unknown venue explains there is no card', async ({ app, screen }) => {
  await app.open('/@nobody-here')

  await expect(screen.getByText('No card here')).toBeVisible()
})
