import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import * as v from 'valibot'

import { SURFACES } from '../../stack.config.ts'
import { operatorWithTwoProfiles, signInOperator } from '../support/operator.ts'
import { apiRequest } from '../support/seed.ts'

const assetId = `0x${'cd'.repeat(32)}`

test('creates a licence card and reads its applicants', async ({ browser, screen }) => {
  const { first } = await operatorWithTwoProfiles()
  const me = await apiRequest('/issuers/me', v.object({ requirementRegistries: v.array(v.string()) }), {
    token: first.token,
  })
  expect(me.requirementRegistries).toHaveLength(1)
  await signInOperator(browser, first.token)
  await browser.goto(`${SURFACES.dash.origin}/cards/new`, { waitUntil: 'networkidle' })
  await screen.getByLabel('Card title', { exact: true }).fill('Licence club')
  await browser.locator('#identity').selectOption({ value: 'address' })
  await screen.getByLabel('Asset id', { exact: true }).fill('bad')
  await screen.getByLabel('Terms id (optional)', { exact: true }).tap()
  await expect(screen.getByText('Enter 0x followed by 64 hexadecimal characters.')).toBeVisible()
  await screen.getByLabel('Asset id', { exact: true }).fill(assetId)
  await screen.getByRole('button', 'Create card', { exact: true }).tap()
  await expect(screen.getByRole('heading', 'Your Cards')).toBeVisible()
  await browser.goto(`${SURFACES.dash.origin}/cards/licence-club/edit`, { waitUntil: 'networkidle' })
  await expect(screen.getByRole('heading', 'Requirement', { exact: true })).toBeVisible()
  await expect(screen.getByText(assetId, { exact: true })).toBeVisible()
  await expect(screen.getByText('No one has applied yet.')).toBeVisible()
  const applied = await fetch(
    `${SURFACES.dash.origin}/api/v1/issuers/${first.issuer.handle}/licence-club/apply`,
    {
      body: JSON.stringify({ holderAddress: `0x${'12'.repeat(20)}` }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  )
  expect(applied.status).toBe(200)
  await browser.goto(`${SURFACES.dash.origin}/cards/licence-club/edit`, { waitUntil: 'networkidle' })
  await expect(screen.getByText(`0x${'12'.repeat(20)}`, { exact: true })).toBeVisible()
  await expect(screen.getByRole('button', 'Copy address')).toBeVisible()
})
