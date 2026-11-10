import type { Context } from 'hono'

// The token of an `Authorization: Bearer` header, or '' when the request has none.
export const bearerToken = (c: Context): string => {
  const header = c.req.header('Authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}
