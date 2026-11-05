import { cancelPasskeyCeremony } from '@fuda/libs/auth'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useRouter } from 'void-preact'

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
  const [busy, setBusy] = useState<SignInMethod | null>(null)
  const [failure, setFailure] = useState<OperatorSignInFailure | null>(null)
  const expired = router.query.get('reason') === 'unauthorized'
  let message: string | null = null
  if (failure !== null) {
    message = signInErrorOf(copy.auth, failure)
  } else if (expired) {
    message = copy.auth.unauthorized
  }
  // Moved on by a cancel or by leaving, so a ceremony that ends afterwards changes
  // nothing. Both live in refs: a rerender must neither forget a running ceremony
  // nor start another, and the guard has to hold before the next render.
  const attempt = useRef(0)
  const running = useRef(false)
  const cancel = (): void => {
    attempt.current += 1
    running.current = false
    cancelPasskeyCeremony()
    setBusy(null)
  }
  useEffect(
    () => () => {
      attempt.current += 1
      cancelPasskeyCeremony()
    },
    [],
  )
  const run = (method: SignInMethod, ceremony: () => Promise<SignInOutcome>): void => {
    if (running.current) {
      return
    }
    running.current = true
    attempt.current += 1
    const { current } = attempt
    setBusy(method)
    setFailure(null)
    const finish = async (): Promise<void> => {
      const outcome = await ceremony().catch(() => ({ failure: 'network' as const, ok: false as const }))
      if (attempt.current !== current) {
        return
      }
      running.current = false
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
      busy={busy}
      copy={copy.auth}
      error={message}
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
