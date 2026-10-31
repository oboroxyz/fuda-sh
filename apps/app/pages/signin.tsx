import type { SignInFailure } from '@fuda/libs/auth'
import { useRouter } from '@void/solid'
import { createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { DEFAULT_MEMBER_IO, signInMember } from '../src/member/auth.ts'
import { SignIn } from '../src/member/SignIn.tsx'
import { useApp, useNavigate } from '../src/page-context.tsx'
import { safeMemberReturn } from '../src/route.ts'

export default function SignInPage(): JSX.Element {
  const shared = useApp()
  const router = useRouter()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(false)
  const [failure, setFailure] = createSignal<SignInFailure | null>(null)
  let abort: AbortController | null = null
  const cancel = (): void => {
    abort?.abort()
    abort = null
    setBusy(false)
  }
  onCleanup(cancel)
  const onSignIn = (): void => {
    if (abort !== null) {
      return
    }
    const current = new AbortController()
    abort = current
    setBusy(true)
    setFailure(null)
    const run = async (): Promise<void> => {
      const outcome = await signInMember(DEFAULT_MEMBER_IO, current.signal)
      if (abort !== current) {
        return
      }
      abort = null
      setBusy(false)
      if (!outcome.ok) {
        setFailure(outcome.failure)
        return
      }
      await router.visit(safeMemberReturn(router.query.get('return')), { replace: true })
    }
    void run()
  }
  return (
    <SignIn
      busy={busy()}
      failure={failure()}
      locale={shared.locale}
      onCancel={cancel}
      onNavigate={(path) => {
        cancel()
        navigate(path)
      }}
      onSignIn={onSignIn}
    />
  )
}
