import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

import { issueBearerRight } from '../support/seed.ts'

const PASTE_BOX = 'paste fuda:v1:… or 0x…'

test('a bearer pass admits once, then reads as already used', async ({ app, screen }) => {
  const right = await issueBearerRight()
  await app.open('/')

  await screen.getByRole('textbox', PASTE_BOX).fill(right.qr)
  await screen.getByRole('button', 'Check').tap()
  const verdict = screen.getByRole('button', /tap to scan again/u)
  await expect(verdict).toContainText('ADMIT')

  await verdict.tap()
  await screen.getByRole('textbox', PASTE_BOX).fill(right.qr)
  await screen.getByRole('button', 'Check').tap()
  await expect(verdict).toContainText('REJECT')
  await expect(verdict).toContainText('ALREADY_USED')
})

test('input that is not a pass is rejected without a lookup', async ({ app, screen }) => {
  await app.open('/')

  await screen.getByRole('textbox', PASTE_BOX).fill('hello')
  await screen.getByRole('button', 'Check').tap()
  const verdict = screen.getByRole('button', /tap to scan again/u)
  await expect(verdict).toContainText('REJECT')
  await expect(verdict).toContainText('not a fuda pass')

  await verdict.tap()
  await expect(screen.getByRole('textbox', PASTE_BOX)).toBeVisible()
})

test('a reader-only station shows one waiting line', async ({ app, screen }) => {
  await app.open('/?camera=off')

  await expect(screen.getByText('present your pass')).toBeVisible()
  await expect(screen.getByRole('textbox', PASTE_BOX)).toBeHidden()
})

// A desk QR reader is a keyboard: it types the payload and presses Enter. While
// a verdict fills the screen there is no field, so the page itself must catch
// the next scan instead of losing it.
test('a reader scan while a verdict is showing replaces it', async ({ app, browser, screen }) => {
  const right = await issueBearerRight()
  await app.open('/?camera=off')

  await browser.keyboard.type(right.qr)
  await browser.keyboard.press('Enter')
  const verdict = screen.getByRole('button', /tap to scan again/u)
  await expect(verdict).toContainText('ADMIT')

  await browser.keyboard.type(right.qr)
  await browser.keyboard.press('Enter')
  await expect(verdict).toContainText('ALREADY_USED')
})
