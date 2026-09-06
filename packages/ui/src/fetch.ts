export type Result<T> = { ok: true; body: T } | { ok: false; error: string; status: number; network: boolean }

// The request headers as this client models them: a plain record, because the
// merge below spreads them and spreading a `Headers` instance or an entry array
// would silently drop every header the caller passed.
export interface ApiHeaders {
  [name: string]: string
}

export interface ApiInit extends Omit<RequestInit, 'headers'> {
  headers?: ApiHeaders
  token?: string
}

// The caller's headers are the base and this pair wins on a conflict — the token
// and the body's media type are the client's contract, not the call site's.
// `content-type` is set only when there is a body: a bodyless GET that carries
// it is a non-simple request and buys a CORS preflight for nothing.
const headersFor = (
  base: ApiHeaders | undefined,
  token: string | undefined,
  hasBody: boolean,
): ApiHeaders => {
  const headers: ApiHeaders = { ...base }
  if (hasBody) {
    headers['content-type'] = 'application/json'
  }
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`
  }
  return headers
}

// Every 5xx and every transport failure is a network condition (the gate fails
// closed on it); a 4xx carries the api's error code; a 2xx that is not
// JSON is a bad response, not an outage.
export const apiFetch = async <T>(base: string, path: string, init: ApiInit = {}): Promise<Result<T>> => {
  const { headers, token, ...rest } = init
  try {
    const res = await fetch(`${base.replace(/\/$/u, '')}${path}`, {
      ...rest,
      headers: headersFor(headers, token, rest.body !== undefined && rest.body !== null),
    })
    if (res.status >= 500) {
      return { error: `api ${res.status}`, network: true, ok: false, status: res.status }
    }
    // A 4xx from a proxy is often HTML, not JSON: parsing it must not throw into
    // the transport branch below, or the caller sees an outage for what is
    // really a bad request.
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an untyped JSON error body
      const isObject = typeof json === 'object' && json !== null
      const error = isObject && 'error' in json ? String(json.error) : `api ${res.status}`
      return { error, network: false, ok: false, status: res.status }
    }
    if (json === null) {
      return { error: 'bad_response', network: false, ok: false, status: res.status }
    }
    // SAFETY: each api endpoint's 2xx body is the typed response the caller names.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the response body is untyped JSON
    return { body: json as T, ok: true }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'network error',
      network: true,
      ok: false,
      status: 0,
    }
  }
}
