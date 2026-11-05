import type { JSX } from 'preact'
import { lazy, Suspense } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'

import { useApp } from '../../../src/page-context.tsx'
import { CardScreen } from '../../../src/venue/CardScreen.tsx'
import { VenueScreen } from '../../../src/venue/VenueScreen.tsx'
import type { Props } from './index.server.ts'

const StorePreview = import.meta.env.DEV
  ? lazy(async () => {
      const preview = await import('../../../src/venue/StorePreview.tsx')
      return { default: preview.StorePreview }
    })
  : null

export default function VenuePage(props: Props): JSX.Element | null {
  const shared = useApp()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  if (props.preview && StorePreview !== null) {
    return mounted ? (
      <Suspense fallback={null}>
        <StorePreview />
      </Suspense>
    ) : null
  }
  if (props.page.kind === 'card') {
    return (
      <CardScreen
        handle={props.page.handle}
        initial={props.venue}
        locale={shared.locale}
        signedIn={shared.signedIn}
        slug={props.page.slug}
      />
    )
  }
  return (
    <VenueScreen
      handle={props.page.handle}
      initial={props.venue}
      locale={shared.locale}
      mode={props.page.kind === 'home' ? 'home' : 'entry'}
    />
  )
}
