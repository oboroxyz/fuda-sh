import { once } from 'node:events'
import { createServer } from 'node:http'

import * as v from 'valibot'

import { API_ORIGIN } from '../../stack.config.ts'

// Use a real loopback origin so Chromium enforces ordinary CORS without the
// address-space classification of a synthetic, intercepted document.
export const startConnectedClient = async (verifier: string) => {
  let clientId = ''
  let origin = ''
  let operatorCookieSeen = false
  const server = createServer((request, response) => {
    operatorCookieSeen ||= request.headers.cookie?.includes('fuda_operator=') === true
    response.setHeader('content-type', 'text/html')
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>External test app</title>
      <h1>External test app</h1><p role="status" id="status">Connecting</p>
      <button id="create" disabled>Create test card</button><button id="read" disabled>Read cards</button>
      <script type="module">
      const api = ${JSON.stringify(API_ORIGIN)};
      const clientId = ${JSON.stringify(clientId)};
      const verifier = ${JSON.stringify(verifier)};
      const status = document.getElementById('status');
      const create = document.getElementById('create');
      const read = document.getElementById('read');
      const query = new URLSearchParams(location.search);
      let token = sessionStorage.getItem('access-token');
      try {
        if (query.has('code')) {
          const response = await fetch(api + '/v1/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: query.get('code'), redirect_uri: ${JSON.stringify(`${origin}/`)}, code_verifier: verifier }) });
          if (!response.ok) throw new Error('Token exchange HTTP ' + response.status);
          token = (await response.json()).access_token;
          sessionStorage.setItem('access-token', token);
          history.replaceState(null, '', '/');
        }
        if (!token) throw new Error('No access token');
        status.textContent = 'Connected'; create.disabled = false; read.disabled = false;
        create.onclick = async () => {
          const response = await fetch(api + '/v1/connect/cards', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ category: 'ticket', title: 'External E2E card', slug: 'external-e2e', description: '', lockScreen: false }) });
          const body = await response.json();
          status.textContent = response.ok ? 'Created ' + body.card.title : 'Create HTTP ' + response.status;
        };
        read.onclick = async () => {
          const response = await fetch(api + '/v1/connect/cards', { headers: { authorization: 'Bearer ' + token } });
          status.textContent = response.ok ? (await response.json()).cards.map(card => card.title).join(', ') : 'Read HTTP ' + response.status;
        };
      } catch (error) { status.textContent = String(error); }
      </script></html>`)
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  const address = v.parse(v.object({ port: v.number() }), server.address())
  origin = `http://localhost:${String(address.port)}`
  return {
    close: async (): Promise<void> => {
      const stopped = once(server, 'close')
      server.closeAllConnections()
      server.close()
      await stopped
    },
    origin,
    receivedOperatorCookie: (): boolean => operatorCookieSeen,
    setClientId: (value: string): void => {
      clientId = value
    },
  }
}
