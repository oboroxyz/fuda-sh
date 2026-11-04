import { useRouter } from '@void/solid'
import type { JSX } from 'solid-js'

import { approveAuthorization, authorizePreview } from '../../src/connected-apps-api.ts'
import { CONSENT_COPY } from '../../src/consent-copy.ts'
import { readAuthorizeRequest } from '../../src/consent.ts'
import { OAuthConsentPage } from '../../src/OAuthConsentPage.tsx'
import { signInWithPasskey, signInWithWallet } from '../../src/operator-sign-in.ts'
import type { SignInOutcome } from '../../src/operator-sign-in.ts'
import { useDash } from '../../src/page-context.tsx'

// Refresh supplies the new cookie's comparison value without exposing it.
const reloaded = (result: SignInOutcome): SignInOutcome => {
  if (result.ok) {
    window.location.reload()
  }
  return result
}

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
        signIn: async () => reloaded(await signInWithPasskey()),
        signInWithWallet: async () => reloaded(await signInWithWallet()),
      }}
    />
  )
}
