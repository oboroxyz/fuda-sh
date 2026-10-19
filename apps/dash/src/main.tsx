/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import { getLocale } from '@fuda/i18n/browser'
import { applyThemeMode, readThemeMode } from '@fuda/ui'
import { render } from 'hono/jsx/dom'

import { App } from './App.tsx'
import { approveAuthorization, authorizePreview } from './connected-apps-api.ts'
import { CONSENT_COPY } from './consent-copy.ts'
import { readAuthorizeRequest } from './consent.ts'
import { OAuthConsentPage } from './OAuthConsentPage.tsx'
import { DEFAULT_OPERATOR_IO } from './operator-io.ts'
import { clearOperatorToken, readOperatorToken, saveOperatorToken } from './operator-session.ts'

const initialTheme = readThemeMode()
applyThemeMode(initialTheme)
const root = document.querySelector<HTMLElement>('#root')
// The connected-app consent page is rendered on its own, before the dashboard
// router could rewrite the path or drop the query the app sent.
if (root !== null && location.pathname === '/oauth/authorize') {
  render(
    <OAuthConsentPage
      copy={pick(CONSENT_COPY, getLocale())}
      dashboardUrl="/"
      io={{
        approve: approveAuthorization,
        assign: (url) => {
          location.assign(url)
        },
        clearToken: () => {
          clearOperatorToken(readOperatorToken())
        },
        preview: authorizePreview,
        readToken: readOperatorToken,
        saveToken: saveOperatorToken,
        signIn: async () => {
          const outcome = await DEFAULT_OPERATOR_IO.signIn()
          return outcome.ok ? { ok: true, token: outcome.token } : { ok: false }
        },
      }}
      request={readAuthorizeRequest(location.search)}
    />,
    root,
  )
} else if (root !== null) {
  render(<App initialTheme={initialTheme} />, root)
}
