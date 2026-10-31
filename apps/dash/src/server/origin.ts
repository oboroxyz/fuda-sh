import type { Context } from 'hono'

// A write from another site's page is refused before it reaches the api or
// touches a cookie. SameSite=Lax keeps the cookie off such a request, but the
// session routes set cookies rather than read them: without this, any page
// could sign the browser in to an account of its choosing (login CSRF).
// A request with no Origin (not from a browser page) is left alone.
export const crossOriginWrite = (c: Context): Response | null => {
  const origin = c.req.header('origin')
  if (c.req.method === 'GET' || origin === undefined || origin === new URL(c.req.url).origin) {
    return null
  }
  return c.json({ error: 'forbidden_origin' }, 403)
}
