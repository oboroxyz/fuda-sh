import { CONNECTED_APP_SCOPES } from '@fuda/sdk'
import type { Context } from 'hono'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { resolveAccessToken } from '../connected-apps/store.ts'
import type { AppEnv } from '../env.ts'
import { mcpResource } from '../mcp/resource.ts'
import { issuerOf, MCP_TOOLS } from '../mcp/tools.ts'

// docs/specs/mcp.md — a stateless JSON-RPC endpoint on the 2025-11-25 revision.
// Each POST stands alone, so no session or stream is kept. A client that probes
// a later revision first receives the method-not-found answer it falls back on.
const PROTOCOL_VERSION = '2025-11-25'

const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp'

const JsonRpcRequest = v.object({
  id: v.optional(v.union([v.string(), v.number()])),
  jsonrpc: v.literal('2.0'),
  method: v.string(),
  params: v.optional(v.record(v.string(), v.unknown()), {}),
})

const ToolCallParams = v.object({
  arguments: v.optional(v.record(v.string(), v.unknown()), {}),
  name: v.string(),
})

type RequestId = string | number | null

// oxlint-disable-next-line anti-slop/no-object-parameters -- each JSON-RPC method has its own result shape
const rpcResult = (c: Context<AppEnv>, id: RequestId, result: object): Response =>
  c.json({ id, jsonrpc: '2.0', result })

const rpcError = (
  c: Context<AppEnv>,
  id: RequestId,
  code: number,
  message: string,
  status: 400 | 403 | 404 = 400,
): Response => c.json({ error: { code, message }, id, jsonrpc: '2.0' }, status)

// RFC 9728 §5.1: every refusal points the client at how to get a usable token.
const challenge = (c: Context<AppEnv>, parts: readonly string[]): string =>
  `Bearer ${[...parts, `resource_metadata="${new URL(METADATA_PATH, c.env.API_BASE_URL).href}"`].join(', ')}`

const refuseToken = (c: Context<AppEnv>, token: string): Response => {
  c.header(
    'WWW-Authenticate',
    challenge(c, [
      ...(token === '' ? [] : ['error="invalid_token"']),
      `scope="${CONNECTED_APP_SCOPES.join(' ')}"`,
    ]),
  )
  return c.json({ error: 'unauthorized' }, 401)
}

export const postMcp = defineHandler(async (c) => {
  c.header('cache-control', 'no-store')
  // DNS-rebinding defence: no browser page calls this server.
  if (c.req.header('Origin') !== undefined) {
    return rpcError(c, null, -32_600, 'Origin not allowed', 403)
  }
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const grant = token === '' ? null : await resolveAccessToken(c.get('db'), token, c.get('now')())
  if (grant === null || grant.resource !== mcpResource(c.env.API_BASE_URL)) {
    return refuseToken(c, token)
  }
  const parsed = v.safeParse(JsonRpcRequest, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return rpcError(c, null, -32_600, 'Invalid request')
  }
  const { id, method, params } = parsed.output
  if (id === undefined) {
    return c.body(null, 202)
  }
  if (method === 'initialize') {
    return rpcResult(c, id, {
      capabilities: { tools: {} },
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: 'fuda', version: '1.0.0' },
    })
  }
  if (method === 'ping') {
    return rpcResult(c, id, {})
  }
  if (method === 'tools/list') {
    return rpcResult(c, id, {
      tools: MCP_TOOLS.filter((tool) => grant.scope.includes(tool.scope)).map(
        ({ annotations, description, inputSchema, name, title }) => ({
          annotations,
          description,
          inputSchema,
          name,
          title,
        }),
      ),
    })
  }
  if (method !== 'tools/call') {
    return rpcError(c, id, -32_601, 'Method not found', 404)
  }
  const call = v.safeParse(ToolCallParams, params)
  const tool = call.success ? MCP_TOOLS.find((entry) => entry.name === call.output.name) : undefined
  if (!call.success || tool === undefined) {
    return rpcError(c, id, -32_602, 'Unknown tool')
  }
  if (!grant.scope.includes(tool.scope)) {
    c.header('WWW-Authenticate', challenge(c, ['error="insufficient_scope"', `scope="${tool.scope}"`]))
    return rpcError(c, id, -32_600, 'Insufficient scope', 403)
  }
  const issuer = await issuerOf(c.get('db'), grant.issuerId)
  if (issuer === undefined) {
    return refuseToken(c, token)
  }
  const outcome = await tool.run({ c, issuer }, call.output.arguments)
  return rpcResult(c, id, {
    content: [{ text: JSON.stringify(outcome.ok ? outcome.value : { error: outcome.error }), type: 'text' }],
    isError: !outcome.ok,
  })
})

// This revision keeps no server stream to open and no session to end.
export const noStream = defineHandler((c) => c.body(null, 405, { Allow: 'POST' }))

export const getProtectedResourceMetadata = defineHandler((c) =>
  c.json({
    authorization_servers: [new URL(c.env.API_BASE_URL).origin],
    bearer_methods_supported: ['header'],
    resource: mcpResource(c.env.API_BASE_URL),
    resource_name: 'fuda',
    scopes_supported: CONNECTED_APP_SCOPES,
  }),
)

export const getAuthorizationServerMetadata = defineHandler((c) => {
  const api = c.env.API_BASE_URL
  return c.json({
    authorization_endpoint: new URL('/oauth/authorize', c.env.DASH_BASE_URL).href,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code'],
    issuer: new URL(api).origin,
    response_types_supported: ['code'],
    revocation_endpoint: new URL('/v1/oauth/revoke', api).href,
    scopes_supported: CONNECTED_APP_SCOPES,
    token_endpoint: new URL('/v1/oauth/token', api).href,
    token_endpoint_auth_methods_supported: ['none'],
  })
})
