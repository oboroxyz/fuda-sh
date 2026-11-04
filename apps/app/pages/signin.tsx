import { useRouter } from '@void/solid'
import { createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { cancelPasskeyCeremony, createPasskeyAccount, signInWithPasskey } from '../src/member/auth.ts'
import type { PasskeyFailure, PasskeyOutcome } from '../src/member/auth.ts'
import { SignIn } from '../src/member/SignIn.tsx'
import { useApp, useNavigate } from '../src/page-context.tsx'
import { safeMemberReturn } from '../src/route.ts'

export default function SignInPage(): JSX.Element {
  const shared = useApp()
  const router = useRouter()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal<'create' | 'signin' | null>(null)
  const [failure, setFailure] = createSignal<PasskeyFailure | null>(null)
  // Moved on by a cancel or by leaving, so a ceremony that ends afterwards changes nothing.
  let attempt = 0
  const cancel = (): void => {
    attempt += 1
    cancelPasskeyCeremony()
    setBusy(null)
  }
  onCleanup(cancel)
  const run = (kind: 'create' | 'signin', ceremony: () => Promise<PasskeyOutcome>): void => {
    if (busy() !== null) {
      return
    }
    attempt += 1
    const current = attempt
    setBusy(kind)
    setFailure(null)
    const finish = async (): Promise<void> => {
      const outcome = await ceremony()
      if (attempt !== current) {
        return
      }
      setBusy(null)
      if (!outcome.ok) {
        setFailure(outcome.failure)
        return
      }
      await router.visit(safeMemberReturn(router.query.get('return')), { replace: true })
    }
    void finish()
  }
  return (
    <SignIn
      busy={busy()}
      failure={failure()}
      locale={shared.locale}
      onCancel={cancel}
      onCreate={() => {
        run('create', createPasskeyAccount)
      }}
      onNavigate={(path) => {
        cancel()
        navigate(path)
      }}
      onSignIn={() => {
        run('signin', signInWithPasskey)
      }}
    />
  )
}
