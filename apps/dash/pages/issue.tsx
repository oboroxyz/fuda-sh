import type { JSX } from 'solid-js'

import { issueRight } from '../src/api.ts'
import { IssueForm } from '../src/IssueForm.tsx'
import { useCopy, useSessionExpired } from '../src/page-context.tsx'

export default function Issue(): JSX.Element {
  const copy = useCopy()
  const expired = useSessionExpired()
  return (
    <IssueForm
      copy={copy().issue}
      onIssue={async (body) => {
        const result = await issueRight(body)
        if (!result.ok && result.status === 401) {
          expired()
        }
        return result
      }}
    />
  )
}
