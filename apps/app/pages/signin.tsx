import { cancelPasskeyCeremony } from '@fuda/libs/auth'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useRouter } from 'void-preact'

import { memberPasskeys } from '../src/member/auth.ts'
import type { PasskeyFailure, PasskeyOutcome } from '../src/member/auth.ts'
import { SignIn } from '../src/member/SignIn.tsx'
import { useApp, useNavigate } from '../src/page-context.tsx'
import { safeMemberReturn } from '../src/route.ts'

export default function SignInPage(): JSX.Element {
  const shared = useApp()
  const router = useRouter()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<'create' | 'signin' | null>(null)
  const [failure, setFailure] = useState<PasskeyFailure | null>(null)
  // Moved on by a cancel or by leaving, so a ceremony that ends afterwards changes nothing.
  const attempt = useRef(0)
  const busyRef = useRef(false)
  const cancel = (): void => {
    attempt.current += 1
    cancelPasskeyCeremony()
    busyRef.current = false
    setBusy(null)
  }
  useEffect(() => cancel, [])
  const run = (kind: 'create' | 'signin', ceremony: () => Promise<PasskeyOutcome>): void => {
    if (busyRef.current) {
      return
    }
    attempt.current += 1
    const { current } = attempt
    busyRef.current = true
    setBusy(kind)
    setFailure(null)
    const finish = async (): Promise<void> => {
      const outcome = await ceremony()
      if (attempt.current !== current) {
        return
      }
      busyRef.current = false
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
      busy={busy}
      failure={failure}
      locale={shared.locale}
      onCancel={cancel}
      onCreate={() => {
        run('create', memberPasskeys.create)
      }}
      onNavigate={(path) => {
        cancel()
        navigate(path)
      }}
      onSignIn={() => {
        run('signin', memberPasskeys.signIn)
      }}
    />
  )
}
