import { useRouter } from '@void/solid'
import { createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

import { signInChallenge } from '../src/api.ts'
import { ENS_PAYMASTER_URL } from '../src/config.ts'
import { signInWithPasskey } from '../src/operator-sign-in.ts'
import type { SignInFailure } from '../src/operator-sign-in.ts'
import { Appearance, useCopy } from '../src/page-context.tsx'
import { homeFor } from '../src/router.ts'
import { verifyOperator, startAdminSession } from '../src/session-client.ts'
import { SignIn, signInErrorOf } from '../src/SignIn.tsx'
import { baseAccountProvider, personalSign, requestAccount } from '../src/wallet.ts'

export default function SignInPage(): JSX.Element {
  const copy = useCopy()
  const router = useRouter()
  const [pending, setPending] = createSignal(false)
  const [failure, setFailure] = createSignal<SignInFailure | null>(null)
  const expired = (): boolean => router.query.get('reason') === 'unauthorized'
  const message = (): string | null => {
    const current = failure()
    if (current !== null) {
      return signInErrorOf(copy().auth, current)
    }
    return expired() ? copy().auth.unauthorized : null
  }
  const onPasskey = (): void => {
    setFailure(null)
    setPending(true)
    const run = async (): Promise<void> => {
      const outcome = await signInWithPasskey({
        challenge: signInChallenge,
        personalSign,
        provider: async () => await baseAccountProvider(ENS_PAYMASTER_URL),
        requestAccount,
        verify: verifyOperator,
      }).catch(() => ({ failure: 'network' as const, ok: false as const }))
      setPending(false)
      if (!outcome.ok) {
        setFailure(outcome.failure)
        return
      }
      await router.visit(homeFor('operator', outcome.hasIssuer))
    }
    void run()
  }
  const onToken = (token: string): void => {
    const run = async (): Promise<void> => {
      const result = await startAdminSession(token)
      if (!result.ok) {
        setFailure('network')
        return
      }
      await router.visit(homeFor('admin', false))
    }
    void run()
  }
  return (
    <SignIn
      appearance={<Appearance />}
      copy={copy().auth}
      error={message()}
      onPasskey={onPasskey}
      onToken={onToken}
      pending={pending()}
    />
  )
}
