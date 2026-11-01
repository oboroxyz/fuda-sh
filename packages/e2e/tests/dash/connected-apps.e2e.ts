import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import * as v from 'valibot'

import { API_ORIGIN, SURFACES } from '../../stack.config.ts'
import { startCallback, startConnectedClient } from '../support/connected-client.ts'
import { operatorWithTwoProfiles, signInOperator } from '../support/operator.ts'
import { apiRequest, uniqueName } from '../support/seed.ts'

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

test(
  'an agent is approved on the consent page and revoking stays off unless ticked',
  { timeout: 90_000 },
  async ({ browser, screen }) => {
    const verifier = 'e2e-mcp-verifier-'.repeat(4)
    const callback = await startCallback()
    try {
      const { first } = await operatorWithTwoProfiles()
      const { app } = await apiRequest(
        '/connected-apps',
        v.object({ app: v.object({ clientId: v.string() }) }),
        {
          body: JSON.stringify({ name: uniqueName('agent'), redirectUris: [callback.redirectUri] }),
          method: 'POST',
          token: first.token,
        },
      )
      await signInOperator(browser, first.token)
      const resource = `${API_ORIGIN}/mcp`
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
      ).toString('base64url')
      const params = new URLSearchParams({
        client_id: app.clientId,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        redirect_uri: callback.redirectUri,
        resource,
        response_type: 'code',
        scope: 'cards:read passes:read passes:issue passes:revoke',
      })
      await browser.goto(`${SURFACES.dash.origin}/oauth/authorize?${params.toString()}`, {
        waitUntil: 'networkidle',
      })
      await expect(screen.getByText('Issue passes', { exact: true })).toBeVisible()
      await expect(screen.getByLabel(/^Also allow revoking passes/u)).toBeVisible()
      await screen.getByRole('button', 'Approve', { exact: true }).tap()

      const code = await callback.code
      const token = await fetch(`${API_ORIGIN}/v1/oauth/token`, {
        body: new URLSearchParams({
          client_id: app.clientId,
          code,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: callback.redirectUri,
          resource,
        }),
        headers: { 'CF-Connecting-IP': '203.0.113.21' },
        method: 'POST',
      })
      const { access_token: accessToken, scope } = v.parse(
        v.object({ access_token: v.string(), scope: v.string() }),
        await token.json(),
      )
      expect(scope).toBe('cards:read passes:read passes:issue')
      const listed = await fetch(resource, {
        body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list' }),
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        method: 'POST',
      })
      const { result } = v.parse(
        v.object({ result: v.object({ tools: v.array(v.object({ name: v.string() })) }) }),
        await listed.json(),
      )
      expect(result.tools.map(({ name }) => name).join(' ')).toBe('list_cards list_passes issue_pass')
    } finally {
      await callback.close()
    }
  },
)
