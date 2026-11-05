import { useRouter } from '@void/solid'
import type { JSX } from 'solid-js'

import { CardDetailPage } from '../../../src/CardDetailPage.tsx'
import { useCopy, useNavigate, useOperator } from '../../../src/page-context.tsx'

// Retain the working router params until the Preact port. Void 1.6.2 also fixes
// the stale useParams context (voidzero-dev/void#709).
export default function CardDetail(): JSX.Element {
  const copy = useCopy()
  const router = useRouter()
  const navigate = useNavigate()
  const { cards, publicUrl } = useOperator()
  return (
    <CardDetailPage
      card={cards().find((card) => card.slug === router.params.slug) ?? null}
      copy={copy()}
      onNavigate={navigate}
      publicUrl={publicUrl() ?? ''}
    />
  )
}
