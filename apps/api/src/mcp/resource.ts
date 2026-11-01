// docs/specs/mcp.md#authorization — the one MCP server this api is, named by its
// canonical URI (RFC 8707).
export const mcpResource = (apiBaseUrl: string): string => new URL('/mcp', apiBaseUrl).href

// The OAuth issuer (RFC 8414), which is the api even though the consent page is
// on the dashboard. A client checks it on the way back (RFC 9207).
export const authorizationIssuer = (apiBaseUrl: string): string => new URL(apiBaseUrl).origin

// The canonical URI when `raw` names this server, otherwise null.
export const mcpResourceFor = (raw: string, apiBaseUrl: string): string | null => {
  const expected = mcpResource(apiBaseUrl)
  return URL.canParse(raw) && new URL(raw).href === expected ? expected : null
}
