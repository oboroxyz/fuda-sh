import type { CardInput, ConnectedAppResponse, TokenResponse } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'

import { pkceChallenge } from '../src/connected-apps/store.ts'
import { getDb } from '../src/db/client.ts'
import {
  cards,
  challenges,
  members,
  connectedAppRedirects,
  connectedApps,
  issuers,
  oauthCodes,
  oauthTokens,
  rateLimits,
  sessions,
} from '../src/db/schema.ts'
import { ISSUE_BUDGET, REVOKE_BUDGET } from '../src/mcp/tools.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, getJson, postJson, registerVenueWithCard, SECOND_CARD, signIn } from './operator.ts'

const REDIRECT_URI = 'http://localhost:8080/callback'
const VERIFIER = 'v'.repeat(43)
const API = 'https://api.fuda.sh'
const RESOURCE = `${API}/mcp`
const METADATA_URL = `${API}/.well-known/oauth-protected-resource/mcp`

const chain = fakeChain({ signer: ROOT })
const delegation = seedRoot(chain)
const bindings = () => ({
  ...configuredEnv(delegation),
  API_BASE_URL: API,
  DASH_BASE_URL: 'https://dash.fuda.sh',
})
const app = appWith({ chain, now: () => NOW })
const ALL_SCOPES = 'cards:read cards:write passes:read passes:issue passes:revoke'

interface RpcAnswer {
  error?: { code: number; message: string }
  result?: {
    content?: { text: string; type: string }[]
    isError?: boolean
    protocolVersion?: string
    tools?: { name: string }[]
  }
}

const clearTables = async (): Promise<void> => {
  const db = getDb({ DB: env.DB })
  await db.delete(members)
  await db.delete(oauthTokens)
  await db.delete(oauthCodes)
  await db.delete(connectedAppRedirects)
  await db.delete(connectedApps)
  await db.delete(rateLimits)
  await db.delete(sessions)
  await db.delete(challenges)
  await db.delete(cards)
  await db.delete(issuers)
}

interface RpcMessage {
  id?: number | string
  jsonrpc: '2.0'
  method: string
  params?: RpcParams
}

interface ToolArguments {
  cardId?: string
  status?: string
  uid?: string
}

interface RpcParams {
  arguments?: CardInput | ToolArguments
  name?: string
  protocolVersion?: string
}

const post = async (
  token: string | null,
  message: RpcMessage,
  origin: string | null = null,
): Promise<Response> => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`)
  }
  if (origin !== null) {
    headers.set('Origin', origin)
  }
  return await app.request('/mcp', { body: JSON.stringify(message), headers, method: 'POST' }, bindings())
}

const rpc = async (token: string, method: string, params: RpcParams = {}): Promise<RpcAnswer> => {
  const res = await post(token, { id: 1, jsonrpc: '2.0', method, params })
  return await res.json<RpcAnswer>()
}

const toolValue = <TSchema extends v.GenericSchema>(
  schema: TSchema,
  answer: RpcAnswer,
): v.InferOutput<TSchema> => v.parse(schema, JSON.parse(answer.result?.content?.[0]?.text ?? ''))

const ToolError = v.object({ error: v.string() })

// An operator's approval, ending in a token for `resource` when one is named.
const approveAndExchange = async (
  options: { resource?: string; scope?: string } = {},
): Promise<{ clientId: string; token: string }> => {
  const { token: session } = await signIn(app, bindings())
  await registerVenueWithCard(app, bindings(), CARD_INPUT, session)
  const created = await postJson(
    app,
    bindings(),
    '/v1/connected-apps',
    { name: 'Claude Code', redirectUris: [REDIRECT_URI] },
    session,
  )
  const { app: registered } = await created.json<ConnectedAppResponse>()
  const me = await getJson(app, bindings(), '/v1/issuers/me', session)
  const { issuer } = await me.json<{ issuer: { id: string } }>()
  const approved = await postJson(
    app,
    bindings(),
    '/v1/oauth/authorize',
    {
      clientId: registered.clientId,
      codeChallenge: await pkceChallenge(VERIFIER),
      codeChallengeMethod: 'S256',
      issuerId: issuer.id,
      redirectUri: REDIRECT_URI,
      resource: options.resource ?? '',
      scope: options.scope ?? '',
    },
    session,
  )
  expect(approved.status).toBe(200)
  const { redirectTo } = await approved.json<{ redirectTo: string }>()
  const form = new URLSearchParams({
    client_id: registered.clientId,
    code: new URL(redirectTo).searchParams.get('code') ?? '',
    code_verifier: VERIFIER,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  })
  if (options.resource !== undefined) {
    form.set('resource', options.resource)
  }
  const res = await app.request(
    '/v1/oauth/token',
    {
      body: form.toString(),
      headers: {
        'CF-Connecting-IP': '203.0.113.7',
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    },
    bindings(),
  )
  expect(res.status).toBe(200)
  const issued = await res.json<TokenResponse>()
  return { clientId: registered.clientId, token: issued.access_token }
}

describe('mcp', () => {
  beforeEach(clearTables)

  it('points the client at the authorization server', async () => {
    const resource = await app.request('/.well-known/oauth-protected-resource/mcp', {}, bindings())
    await expect(resource.json()).resolves.toMatchObject({
      authorization_servers: [API],
      resource: RESOURCE,
      scopes_supported: ALL_SCOPES.split(' '),
    })
    const server = await app.request('/.well-known/oauth-authorization-server', {}, bindings())
    await expect(server.json()).resolves.toMatchObject({
      authorization_endpoint: 'https://dash.fuda.sh/oauth/authorize',
      code_challenge_methods_supported: ['S256'],
      issuer: API,
      token_endpoint: `${API}/v1/oauth/token`,
      token_endpoint_auth_methods_supported: ['none'],
    })
  })

  it('answers 401 with the metadata location before any token exists', async () => {
    const res = await post(null, { id: 1, jsonrpc: '2.0', method: 'initialize' })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe(
      `Bearer scope="${ALL_SCOPES}", resource_metadata="${METADATA_URL}"`,
    )
  })

  it('names an unusable token as invalid', async () => {
    const res = await post('fuda_at_unknown', { id: 1, jsonrpc: '2.0', method: 'initialize' })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
  })

  it('keeps connected-app tokens and MCP tokens on their own routes', async () => {
    const connected = await approveAndExchange()
    const toMcp = await post(connected.token, { id: 1, jsonrpc: '2.0', method: 'tools/list' })
    expect(toMcp.status).toBe(401)
    await clearTables()
    const agent = await approveAndExchange({ resource: RESOURCE })
    const toConnect = await app.request(
      '/v1/connect/cards',
      { headers: { authorization: `Bearer ${agent.token}` } },
      bindings(),
    )
    expect(toConnect.status).toBe(401)
  })

  it('refuses to approve a token for another server', async () => {
    const { token: session } = await signIn(app, bindings())
    await registerVenueWithCard(app, bindings(), CARD_INPUT, session)
    const created = await postJson(
      app,
      bindings(),
      '/v1/connected-apps',
      { name: 'Claude Code', redirectUris: [REDIRECT_URI] },
      session,
    )
    const { app: registered } = await created.json<ConnectedAppResponse>()
    const query = new URLSearchParams({
      client_id: registered.clientId,
      code_challenge_method: 'S256',
      redirect_uri: REDIRECT_URI,
      resource: 'https://other.example/mcp',
      response_type: 'code',
    })
    const preview = await getJson(app, bindings(), `/v1/oauth/authorize?${query.toString()}`, session)
    expect(preview.status).toBe(400)
    await expect(preview.json()).resolves.toStrictEqual({ error: 'invalid_target' })
  })

  it('refuses a token request naming a different resource than the approval', async () => {
    const { token: session } = await signIn(app, bindings())
    await registerVenueWithCard(app, bindings(), CARD_INPUT, session)
    const created = await postJson(
      app,
      bindings(),
      '/v1/connected-apps',
      { name: 'Figma app', redirectUris: [REDIRECT_URI] },
      session,
    )
    const { app: registered } = await created.json<ConnectedAppResponse>()
    const me = await getJson(app, bindings(), '/v1/issuers/me', session)
    const { issuer } = await me.json<{ issuer: { id: string } }>()
    const approved = await postJson(
      app,
      bindings(),
      '/v1/oauth/authorize',
      {
        clientId: registered.clientId,
        codeChallenge: await pkceChallenge(VERIFIER),
        codeChallengeMethod: 'S256',
        issuerId: issuer.id,
        redirectUri: REDIRECT_URI,
      },
      session,
    )
    const { redirectTo } = await approved.json<{ redirectTo: string }>()
    const res = await app.request(
      '/v1/oauth/token',
      {
        body: new URLSearchParams({
          client_id: registered.clientId,
          code: new URL(redirectTo).searchParams.get('code') ?? '',
          code_verifier: VERIFIER,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
          resource: RESOURCE,
        }).toString(),
        headers: {
          'CF-Connecting-IP': '203.0.113.7',
          'content-type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      },
      bindings(),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'invalid_grant' })
  })

  it('refuses any browser Origin, even with a good token', async () => {
    const { token } = await approveAndExchange({ resource: RESOURCE })
    const res = await post(token, { id: 1, jsonrpc: '2.0', method: 'tools/list' }, 'https://dash.fuda.sh')
    expect(res.status).toBe(403)
  })

  it('answers the handshake a client falls back to', async () => {
    const { token } = await approveAndExchange({ resource: RESOURCE })
    const probe = await post(token, { id: 'p', jsonrpc: '2.0', method: 'server/discover' })
    expect(probe.status).toBe(404)
    await expect(probe.json()).resolves.toMatchObject({ error: { code: -32_601 }, id: 'p' })
    const init = await rpc(token, 'initialize', { protocolVersion: '2025-11-25' })
    expect(init.result?.protocolVersion).toBe('2025-11-25')
    const notice = await post(token, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notice.status).toBe(202)
  })

  it('has no stream to open and no session to end', async () => {
    const get = await app.request('/mcp', {}, bindings())
    expect(get.status).toBe(405)
    const del = await app.request('/mcp', { method: 'DELETE' }, bindings())
    expect(del.status).toBe(405)
  })

  it('lists only the tools the token may call', async () => {
    const { token } = await approveAndExchange({ resource: RESOURCE, scope: 'cards:read' })
    const listed = await rpc(token, 'tools/list')
    expect(listed.result?.tools?.map((tool) => tool.name)).toStrictEqual(['list_cards'])
  })

  it('asks for more scope when a tool needs it', async () => {
    const { token } = await approveAndExchange({ resource: RESOURCE, scope: 'cards:read' })
    const res = await post(token, {
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: SECOND_CARD, name: 'create_card' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('WWW-Authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="cards:write", resource_metadata="${METADATA_URL}"`,
    )
  })

  it('lists and creates cards with the link people claim them at', async () => {
    const { token } = await approveAndExchange({ resource: RESOURCE })
    const created = await rpc(token, 'tools/call', { arguments: SECOND_CARD, name: 'create_card' })
    expect(created.result?.isError).toBe(false)
    const { card } = toolValue(v.object({ card: v.object({ claimUrl: v.string() }) }), created)
    expect(card.claimUrl).toContain(`/${SECOND_CARD.slug}`)
    const listed = await rpc(token, 'tools/call', { name: 'list_cards' })
    const { cards: rows } = toolValue(v.object({ cards: v.array(v.object({ slug: v.string() })) }), listed)
    expect(rows.map((row) => row.slug)).toContain(SECOND_CARD.slug)
  })

  it('reports a card rule as a tool error', async () => {
    const { token } = await approveAndExchange({ resource: RESOURCE })
    await rpc(token, 'tools/call', { arguments: SECOND_CARD, name: 'create_card' })
    const repeated = await rpc(token, 'tools/call', { arguments: SECOND_CARD, name: 'create_card' })
    expect(repeated.result?.isError).toBe(true)
    expect(toolValue(ToolError, repeated)).toStrictEqual({ error: 'slug_taken' })
    const invalid = await rpc(token, 'tools/call', {
      arguments: { category: 'ticket', slug: 'BAD SLUG', title: 'x' },
      name: 'create_card',
    })
    expect(toolValue(ToolError, invalid)).toStrictEqual({ error: 'bad_slug' })
  })

  describe('passes', () => {
    const CardId = v.object({ cards: v.array(v.object({ id: v.string() })) })
    const Issued = v.object({ memberNumber: v.string(), passUrl: v.string(), uid: v.string() })

    const agentWithCard = async (scope = ALL_SCOPES): Promise<{ cardId: string; token: string }> => {
      const { token } = await approveAndExchange({ resource: RESOURCE, scope })
      const listed = await rpc(token, 'tools/call', { name: 'list_cards' })
      return { cardId: toolValue(CardId, listed).cards[0]?.id ?? '', token }
    }

    const issue = async (token: string, cardId: string): Promise<RpcAnswer> =>
      await rpc(token, 'tools/call', { arguments: { cardId }, name: 'issue_pass' })

    it('issues a pass, lists it and revokes it', async () => {
      const { cardId, token } = await agentWithCard()
      const issued = toolValue(Issued, await issue(token, cardId))
      expect(issued.passUrl).toBe(`${API}/pass/${issued.uid}`)
      const listed = await rpc(token, 'tools/call', { arguments: { cardId }, name: 'list_passes' })
      expect(
        toolValue(v.object({ passes: v.array(v.object({ status: v.string(), uid: v.string() })) }), listed)
          .passes,
      ).toStrictEqual([expect.objectContaining({ status: 'active', uid: issued.uid })])
      const revoked = await rpc(token, 'tools/call', { arguments: { uid: issued.uid }, name: 'revoke_pass' })
      expect(revoked.result?.isError).toBe(false)
      const after = await rpc(token, 'tools/call', { arguments: { status: 'revoked' }, name: 'list_passes' })
      expect(toolValue(v.object({ page: v.object({ total: v.number() }) }), after).page.total).toBe(1)
    })

    it('issues while the claim window is closed, unlike the public route', async () => {
      const { token } = await agentWithCard()
      const created = await rpc(token, 'tools/call', {
        arguments: { ...SECOND_CARD, claimFrom: NOW + 1000, claimUntil: NOW + 2000 },
        name: 'create_card',
      })
      const { card } = toolValue(
        v.object({ card: v.object({ claimable: v.boolean(), id: v.string() }) }),
        created,
      )
      expect(card.claimable).toBe(false)
      const issued = await issue(token, card.id)
      expect(issued.result?.isError).toBe(false)
    })

    it("treats another issuer's card and pass as not found", async () => {
      const { token } = await agentWithCard()
      await expect(issue(token, 'no-such-card')).resolves.toMatchObject({
        result: { isError: true },
      })
      const revoked = await rpc(token, 'tools/call', {
        arguments: { uid: `0x${'ab'.repeat(32)}` },
        name: 'revoke_pass',
      })
      expect(toolValue(ToolError, revoked)).toStrictEqual({ error: 'not_found' })
    })

    it('stops issuing and revoking at the hourly budget', async () => {
      const { cardId, token } = await agentWithCard()
      const db = getDb({ DB: env.DB })
      const owner = await db.select({ id: issuers.id }).from(issuers).get()
      const windowStart = Math.floor(NOW / 3600) * 3600
      await db.insert(rateLimits).values([
        { count: ISSUE_BUDGET, ip: `mcp-issue:${owner?.id ?? ''}`, windowStart },
        { count: REVOKE_BUDGET, ip: `mcp-revoke:${owner?.id ?? ''}`, windowStart },
      ])
      expect(toolValue(ToolError, await issue(token, cardId))).toStrictEqual({ error: 'rate_limited' })
      const revoked = await rpc(token, 'tools/call', {
        arguments: { uid: `0x${'ab'.repeat(32)}` },
        name: 'revoke_pass',
      })
      expect(toolValue(ToolError, revoked)).toStrictEqual({ error: 'rate_limited' })
    })

    it('never grants pass scopes by default', async () => {
      const { token } = await approveAndExchange({ resource: RESOURCE })
      const listed = await rpc(token, 'tools/list')
      expect(listed.result?.tools?.map((tool) => tool.name)).toStrictEqual(['list_cards', 'create_card'])
    })
  })

  it('answers an unknown tool as a protocol error', async () => {
    const { token } = await approveAndExchange({ resource: RESOURCE })
    const answer = await rpc(token, 'tools/call', { name: 'no_such_tool' })
    expect(answer.error?.code).toBe(-32_602)
  })
})
