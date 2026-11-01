-- RFC 8707 resource indicators: the MCP server a code or token was issued for.
-- NULL is a connected app's token for the /v1/connect routes; the two never
-- answer on each other's routes (docs/specs/mcp.md#authorization).
ALTER TABLE oauth_codes ADD COLUMN resource TEXT;
ALTER TABLE oauth_tokens ADD COLUMN resource TEXT;
