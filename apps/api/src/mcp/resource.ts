// docs/specs/mcp.md#authorization — the one MCP server this api is, named by its
// canonical URI (RFC 8707).
export const mcpResource = (apiBaseUrl: string): string => new URL('/mcp', apiBaseUrl).href

// The canonical URI when `raw` names this server, otherwise null.
export const mcpResourceFor = (raw: string, apiBaseUrl: string): string | null => {
  const expected = mcpResource(apiBaseUrl)
  return URL.canParse(raw) && new URL(raw).href === expected ? expected : null
}
