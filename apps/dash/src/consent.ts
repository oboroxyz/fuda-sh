import type { AuthorizeApprovalRequest } from '@fuda/sdk'

// docs/specs/connected-apps.md#approval — the query a connected app sends the
// browser to `/oauth/authorize` with. Read straight from location.search: the
// dashboard router drops query strings, and these must reach the api intact.
export interface AuthorizeRequest {
  clientId: string
  codeChallenge: string
  codeChallengeMethod: string
  redirectUri: string
  responseType: string
  scope: string
  state: string
}

export const readAuthorizeRequest = (search: string): AuthorizeRequest => {
  const params = new URLSearchParams(search)
  const get = (name: string): string => params.get(name) ?? ''
  return {
    clientId: get('client_id'),
    codeChallenge: get('code_challenge'),
    codeChallengeMethod: get('code_challenge_method'),
    redirectUri: get('redirect_uri'),
    responseType: get('response_type'),
    scope: get('scope'),
    state: get('state'),
  }
}

// What GET /oauth/authorize checks before anything is shown.
export const previewParams = (request: AuthorizeRequest): URLSearchParams =>
  new URLSearchParams({
    client_id: request.clientId,
    code_challenge_method: request.codeChallengeMethod,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    scope: request.scope,
  })

export const approvalBody = (request: AuthorizeRequest, issuerId: string): AuthorizeApprovalRequest => ({
  clientId: request.clientId,
  codeChallenge: request.codeChallenge,
  codeChallengeMethod: 'S256',
  issuerId,
  redirectUri: request.redirectUri,
  scope: request.scope,
  state: request.state,
})

// RFC 6749 §4.1.2.1. Only ever built for a redirect URI the api has already
// matched against the app's registration.
export const deniedRedirect = (redirectUri: string, state: string): string => {
  const url = new URL(redirectUri)
  url.searchParams.set('error', 'access_denied')
  if (state !== '') {
    url.searchParams.set('state', state)
  }
  return url.href
}
