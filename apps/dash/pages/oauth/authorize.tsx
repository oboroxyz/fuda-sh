import { useRouter } from '@void/solid'
import type { JSX } from 'solid-js'

import { signInChallenge } from '../../src/api.ts'
import { ENS_PAYMASTER_URL } from '../../src/config.ts'
import { approveAuthorization, authorizePreview } from '../../src/connected-apps-api.ts'
import { CONSENT_COPY } from '../../src/consent-copy.ts'
import { readAuthorizeRequest } from '../../src/consent.ts'
import { OAuthConsentPage } from '../../src/OAuthConsentPage.tsx'
import { signInWithPasskey } from '../../src/operator-sign-in.ts'
import { useDash } from '../../src/page-context.tsx'
import { verifyOperator } from '../../src/session-client.ts'
import { baseAccountProvider, personalSign, requestAccount } from '../../src/wallet.ts'

export default function Authorize(): JSX.Element {
  const shared = useDash()
  const router = useRouter()
  return (
    <OAuthConsentPage
      copy={CONSENT_COPY[shared.locale]}
      dashboardUrl="/"
      signedIn={shared.surface === 'operator'}
      request={readAuthorizeRequest(`?${router.query.toString()}`)}
      io={{
        approve: approveAuthorization,
        assign: (url) => {
          window.location.assign(url)
        },
        preview: authorizePreview,
        signIn: async () => {
          const result = await signInWithPasskey({
            challenge: signInChallenge,
            personalSign,
            provider: async () => await baseAccountProvider(ENS_PAYMASTER_URL),
            requestAccount,
            verify: verifyOperator,
          })
          // Refresh supplies the new cookie's comparison value without exposing it.
          if (result.ok) {
            window.location.reload()
          }
          return result
        },
      }}
    />
  )
}
