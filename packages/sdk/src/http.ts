// Every route a program calls fuda for is served under this prefix, so a
// breaking change can ship as /v2 while /v1 keeps answering. Four families sit
// outside it deliberately, because their URLs are held by someone fuda cannot
// reach to update: `/pass/*` is saved into Apple and Google Wallet, `/assets/*`
// is printed on pages, `/ens/gateway` is written into the deployed ENS resolver
// on chain, and `/health` is in somebody's monitoring. Those are built by
// `passUrls` and by the api itself, never through `apiFetch`.
export const API_VERSION_PREFIX = '/v1'

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

const readEndpointJson = async <T>(response: Response): Promise<T> =>
  // oxlint-disable-next-line promise/avoid-new -- bridge the DOM's untyped json promise into the caller-owned response contract
  await new Promise((resolve, reject) => {
    void response.json().then(resolve, reject)
  })

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
// One request against a URL that stands on its own — a family outside the
// prefix, built by `passUrls` (`/pass/<uid>/card`). `apiFetch` below is the
// same contract with the prefix added.
export const fetchJson = async <T>(url: string, init: ApiInit = {}): Promise<Result<T>> => {
  const { headers, token, ...rest } = init
  try {
    const res = await fetch(url, {
      ...rest,
      headers: headersFor(headers, token, rest.body !== undefined && rest.body !== null),
    })
    if (res.status >= 500) {
      return { error: `api ${res.status}`, network: true, ok: false, status: res.status }
    }
    if (res.ok) {
      const body = await readEndpointJson<T>(res).catch(() => null)
      if (body === null) {
        return { error: 'bad_response', network: false, ok: false, status: res.status }
      }
      return { body, ok: true }
    }
    // A 4xx from a proxy is often HTML, not JSON: parsing it must not throw into
    // the transport branch below, or the caller sees an outage for what is
    // really a bad request.
    const json: unknown = await res.json().catch(() => null)
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an untyped JSON error body
    const isObject = typeof json === 'object' && json !== null
    const error = isObject && 'error' in json ? String(json.error) : `api ${res.status}`
    return { error, network: false, ok: false, status: res.status }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'network error',
      network: true,
      ok: false,
      status: 0,
    }
  }
}

export const apiFetch = async <T>(base: string, path: string, init: ApiInit = {}): Promise<Result<T>> =>
  // `path` is written as the route sees it (`/verify`), and the prefix is
  // added here so no call site has to remember it.
  await fetchJson<T>(`${base.replace(/\/$/u, '')}${API_VERSION_PREFIX}${path}`, init)
