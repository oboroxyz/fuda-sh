import { useRouter } from '@void/solid'
import type { JSX } from 'solid-js'

import { CardDetailPage } from '../../../src/CardDetailPage.tsx'
import { useCopy, useNavigate, useOperator } from '../../../src/page-context.tsx'

// `useRouter().params`, not `useParams()`: @void/solid 1.4.0's params context
// keeps the first page's values after client navigation.
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
