import { cancelPasskeyCeremony } from '@fuda/libs/auth'
import { useRouter } from '@void/solid'
import { createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { createPasskeyAccount, signInWithPasskey, signInWithWallet } from '../src/operator-sign-in.ts'
import type { OperatorSignInFailure, SignInOutcome } from '../src/operator-sign-in.ts'
import { Appearance, useCopy } from '../src/page-context.tsx'
import { homeFor } from '../src/router.ts'
import { startAdminSession } from '../src/session-client.ts'
import { SignIn, signInErrorOf } from '../src/SignIn.tsx'
import type { SignInMethod } from '../src/SignIn.tsx'

export default function SignInPage(): JSX.Element {
  const copy = useCopy()
  const router = useRouter()
  const [busy, setBusy] = createSignal<SignInMethod | null>(null)
  const [failure, setFailure] = createSignal<OperatorSignInFailure | null>(null)
  const expired = (): boolean => router.query.get('reason') === 'unauthorized'
  const message = (): string | null => {
    const current = failure()
    if (current !== null) {
      return signInErrorOf(copy().auth, current)
    }
    return expired() ? copy().auth.unauthorized : null
  }
  // Moved on by a cancel or by leaving, so a ceremony that ends afterwards changes nothing.
  let attempt = 0
  const cancel = (): void => {
    attempt += 1
    cancelPasskeyCeremony()
    setBusy(null)
  }
  onCleanup(cancel)
  const run = (method: SignInMethod, ceremony: () => Promise<SignInOutcome>): void => {
    if (busy() !== null) {
      return
    }
    attempt += 1
    const current = attempt
    setBusy(method)
    setFailure(null)
    const finish = async (): Promise<void> => {
      const outcome = await ceremony().catch(() => ({ failure: 'network' as const, ok: false as const }))
      if (attempt !== current) {
        return
      }
      setBusy(null)
      if (!outcome.ok) {
        setFailure(outcome.failure)
        return
      }
      await router.visit(homeFor('operator', outcome.hasIssuer))
    }
    void finish()
  }
  const onToken = (token: string): void => {
    const start = async (): Promise<void> => {
      const result = await startAdminSession(token)
      if (!result.ok) {
        setFailure('network')
        return
      }
      await router.visit(homeFor('admin', false))
    }
    void start()
  }
  return (
    <SignIn
      appearance={<Appearance />}
      busy={busy()}
      copy={copy().auth}
      error={message()}
      onCancel={cancel}
      onCreate={() => {
        run('create', createPasskeyAccount)
      }}
      onSignIn={() => {
        run('signin', signInWithPasskey)
      }}
      onToken={onToken}
      onWallet={() => {
        run('wallet', signInWithWallet)
      }}
    />
  )
}
