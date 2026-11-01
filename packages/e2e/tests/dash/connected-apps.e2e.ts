import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

import { SURFACES } from '../../stack.config.ts'
import { startConnectedClient } from '../support/connected-client.ts'
import { operatorWithTwoProfiles, signInOperator } from '../support/operator.ts'
import { uniqueName } from '../support/seed.ts'

test(
  'an operator registers an app, approves PKCE, creates a card and revokes its access',
  { timeout: 90_000 },
  async ({ browser, screen }) => {
    const verifier = 'e2e-verifier-'.repeat(4)
    const client = await startConnectedClient(verifier)
    try {
      const { first } = await operatorWithTwoProfiles()
      await signInOperator(browser, first.token)
      await browser.goto(`${SURFACES.dash.origin}/apps`, { waitUntil: 'networkidle' })
      const appName = uniqueName('browser-app')
      await screen.getByLabel('App name').fill(appName)
      await screen.getByLabel(/^Return addresses/u).fill(`${client.origin}/`)
      await screen.getByRole('button', 'Register', { exact: true }).tap()
      const registered = screen.getByRole('article').filter({ hasText: appName })
      await expect(registered).toBeVisible()
      const clientId = await registered.getByText(/^app_[0-9a-f]{32}$/u).textContent()
      if (clientId === null) {
        throw new Error('Registered app has no client ID')
      }
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
      ).toString('base64url')
      client.setClientId(clientId)
      const params = new URLSearchParams({
        client_id: clientId,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        redirect_uri: `${client.origin}/`,
        response_type: 'code',
        scope: 'cards:read cards:write',
        state: 'e2e-approval',
      })
      await browser.goto(`${SURFACES.dash.origin}/oauth/authorize?${params.toString()}`, {
        waitUntil: 'networkidle',
      })
      await expect(screen.getByText(appName, { exact: true })).toBeVisible()
      await screen.getByRole('radio', new RegExp(first.issuer.handle, 'u')).check()
      await screen.getByRole('button', 'Approve', { exact: true }).tap()
      await expect(screen.getByRole('status')).toHaveText('Connected')
      await screen.getByRole('button', 'Create test card').tap()
      await expect(screen.getByRole('status')).toHaveText('Created External E2E card')
      await screen.getByRole('button', 'Read cards').tap()
      await expect(screen.getByRole('status')).toContainText('External E2E card')

      await browser.goto(`${SURFACES.dash.origin}/apps`, { waitUntil: 'networkidle' })
      const grant = screen
        .getByRole('article')
        .filter({ hasText: appName })
        .filter({ hasText: first.issuer.name })
      await grant.getByRole('button', 'Revoke', { exact: true }).tap()
      await expect(screen.getByText('No app is approved right now.')).toBeVisible()
      await browser.goto(`${client.origin}/`)
      await expect(screen.getByRole('status')).toHaveText('Connected')
      await screen.getByRole('button', 'Read cards').tap()
      await expect(screen.getByRole('status')).toHaveText('Read HTTP 401')
      expect(client.receivedOperatorCookie()).toBe(false)
    } finally {
      await client.close()
    }
  },
)
