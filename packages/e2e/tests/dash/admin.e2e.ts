import { test } from '@e2e-dev/web'
import type { Screen } from 'e2e'
import { expect } from 'e2e'

import { uniqueName } from '../support/seed.ts'

// The e2e api runs without ADMIN_TOKEN, so an empty token signs in. Operator
// passkey and wallet sign-in need an authenticator or a wallet and are not automated here.
const signInAsAdmin = async (screen: Screen): Promise<void> => {
  await screen.getByText('Sign in with an admin token instead').tap()
  await screen.getByRole('button', 'Continue').tap()
  await expect(screen.getByRole('heading', 'Overview')).toBeVisible()
}

test('the sign-in screen offers a passkey and an admin token', async ({ app, screen }) => {
  await app.open('/')

  await expect(screen.getByRole('heading', 'fuda. dashboard')).toBeVisible()
  await expect(screen.getByRole('button', 'Sign in with Passkey')).toBeVisible()
  await screen.getByText('Sign in with an admin token instead').tap()
  await expect(screen.getByLabel('Admin token')).toBeVisible()
})

test('an issued bearer right is listed, then revoked', async ({ app, screen }) => {
  const memberId = uniqueName('member')
  await app.open('/')
  await signInAsAdmin(screen)

  await screen.getByRole('link', 'Issue').first().tap()
  await screen.getByLabel('Member ID').fill(memberId)
  await screen.getByRole('button', 'Issue right').tap()
  await expect(screen.getByText(/^Issued bearer/u)).toBeVisible()
  await expect(screen.getByText(/^fuda:v1:0x[0-9a-f]{64}$/u)).toBeVisible()

  await screen.getByRole('link', 'Rights').first().tap()
  const row = screen.getByRole('row').filter({ hasText: memberId })
  await expect(row).toContainText('Active')

  await row.getByRole('button', 'Revoke').tap()
  const dialog = screen.getByRole('dialog', 'Revoke this right?')
  await dialog.getByRole('button', 'Revoke right').tap()
  await expect(row).toContainText('Revoked')
})
