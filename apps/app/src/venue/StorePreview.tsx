/** @jsxImportSource hono/jsx/dom */
// Loaded only by the opt-in Vite development entry. No API or wallet requests.
import { cardBySlug } from '@fuda/sdk'
import type { PublicVenue } from '@fuda/sdk'
import { applyThemeMode } from '@fuda/ui'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { CardScreenView } from './CardScreen.tsx'
import type { CardScreenState, IssuedCard } from './CardScreen.tsx'
import { cardClaimHref, selectEntry } from './entry.ts'
import coffeeLogo from './preview-assets/wassie-coffee.jpg'
import { StoreHome } from './StoreHome.tsx'

const sampleVenue: PublicVenue = {
  brandColor: '#6F4320',
  cards: [
    {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      description:
        'A little card for your daily coffee.\nKeep Wassie Coffee close at hand. Show your membership card whenever you visit.',
      id: 'preview-membership',
      slug: 'membership',
      title: 'Membership Card',
      validFrom: null,
      validUntil: null,
      validityDays: null,
    },
    {
      category: 'ticket',
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      description: 'A slow Sunday, three single origins.\nSeptember 27 · 10:00–11:00 · Omotesando',
      id: 'preview-tasting',
      slug: 'tasting',
      title: 'Sunday Coffee Tasting',
      validFrom: 1_790_470_800,
      validUntil: 1_790_474_400,
      validityDays: null,
    },
  ],
  handle: 'wassie-coffee',
  logoUrl: coffeeLogo,
  name: 'Wassie Coffee',
  tagline: 'Omotesando · Coffee shop',
}

const params = new URLSearchParams(location.search)
const locale = params.get('lang') === 'ja' ? 'ja' : 'en'
const dark = params.get('theme') === 'dark'
const multiple = params.get('cards') !== 'single'
const previewDefault = (): string | null => {
  switch (params.get('default') ?? '') {
    case 'none': {
      return null
    }
    case 'missing': {
      return 'missing'
    }
    case 'tasting': {
      return 'tasting'
    }
    default: {
      return 'membership'
    }
  }
}
const venue: PublicVenue = {
  ...sampleVenue,
  cards: (multiple ? sampleVenue.cards : sampleVenue.cards.slice(0, 1)).map((item) => ({
    ...item,
    claimable: !(params.get('default') === 'closed' && item.slug === 'membership'),
  })),
  defaultCardSlug: previewDefault(),
}
const previewHref = (scene: string): string => {
  const query = new URLSearchParams({
    cards: multiple || scene === 'choose' ? 'multiple' : 'single',
    lang: locale,
    scene,
    theme: dark ? 'dark' : 'light',
  })
  let path = location.pathname
  if (scene === 'home') {
    path = '/@wassie-coffee/home'
  } else if (scene === 'choose') {
    path = '/@wassie-coffee'
  } else if (/^\/@wassie-coffee(?:\/home)?\/?$/u.test(location.pathname)) {
    path = '/@wassie-coffee/membership'
  }
  return `${path}?${query}`
}
const issued: IssuedCard = {
  holder: `0x${'11'.repeat(20)}`,
  issuedAt: Date.UTC(2026, 8, 11),
  memberNumber: 'qj2yxphepdrka',
  passUrls: {
    apple: previewHref('wallet'),
    google: previewHref('wallet'),
    web: previewHref('browser'),
  },
  qr: 'WASSIE COFFEE — UI PREVIEW ONLY — NOT A VALID PASS',
  uid: `0x${'ab'.repeat(32)}`,
}

const slug = location.pathname.replace(/\/+$/u, '').split('/')[2] ?? null
const choice = selectEntry(venue)
const card = slug === null ? null : cardBySlug(venue, slug)
const ready = (): CardScreenState =>
  card === null
    ? { kind: 'not_found', venue }
    : { appleHref: issued.passUrls.apple, card, googleHref: issued.passUrls.google, issued, kind: 'ready' }

const initialState = (): CardScreenState => {
  if (!/^\/@wassie-coffee(?:\/[^/]+)?\/?$/u.test(location.pathname)) {
    return { kind: 'not_found', venue: null }
  }
  if (card === null) {
    return slug === null
      ? {
          defaultUnavailable: choice.kind === 'choose' && choice.defaultUnavailable,
          heldSlugs: [],
          kind: 'choose',
          venue,
        }
      : { kind: 'not_found', venue }
  }
  switch (params.get('scene') ?? 'landing') {
    case 'ready':
    case 'wallet':
    case 'browser': {
      return ready()
    }
    case 'choose': {
      return { heldSlugs: [], kind: 'choose', venue }
    }
    case 'closed': {
      return { card: { ...card, card: { ...card.card, claimable: false } }, kind: 'landing' }
    }
    case 'error': {
      return { card, failure: 'network', kind: 'error' }
    }
    case 'loading': {
      return { kind: 'loading' }
    }
    default: {
      return { card, kind: 'landing' }
    }
  }
}

const labels =
  locale === 'ja'
    ? {
        browser: 'ブラウザーパスのプレビューです。QRは利用できません。',
        choose: 'カード一覧',
        closed: '配布終了',
        demo: 'UIプレビュー · 発行・保存はされません',
        error: 'エラー',
        home: '店頭表示',
        landing: '受け取り前',
        loading: '読み込み中',
        ready: '受け取り後',
        wallet: 'Walletへの追加を試す画面です。実際には保存されません。',
      }
    : {
        browser: 'Browser pass preview. This QR is not valid for entry.',
        choose: 'Card list',
        closed: 'Closed',
        demo: 'UI preview · Nothing is issued or saved',
        error: 'Error',
        home: 'Store display',
        landing: 'Before claim',
        loading: 'Loading',
        ready: 'After claim',
        wallet: 'Wallet handoff preview. No pass has been saved.',
      }

export const StorePreview = (): JSX.Element => {
  const [state, setState] = useState(initialState)
  useEffect(() => {
    document.documentElement.lang = locale
    applyThemeMode(dark ? 'dark' : 'light')
    if (
      slug === null &&
      params.get('scene') !== 'choose' &&
      params.get('cards') !== 'all' &&
      choice.kind === 'card'
    ) {
      location.replace(`${cardClaimHref(venue.handle, choice.slug)}${location.search}`)
    }
  }, [])
  useEffect(() => {
    // Keep development-only scenario preferences across the real view's links.
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.venue-page a')) {
      const url = new URL(link.href)
      if (
        url.origin === location.origin &&
        url.pathname.startsWith('/@wassie-coffee') &&
        !url.searchParams.has('scene')
      ) {
        if (!url.searchParams.has('cards')) {
          url.searchParams.set('cards', multiple ? 'multiple' : 'single')
        }
        url.searchParams.set('lang', locale)
        url.searchParams.set('theme', dark ? 'dark' : 'light')
        const defaultParam = params.get('default')
        if (defaultParam !== null) {
          url.searchParams.set('default', defaultParam)
        }
        link.href = url.href
      }
    }
  }, [state.kind])
  useEffect(() => {
    if (state.kind !== 'issuing') {
      return
    }
    const timer = setTimeout(() => {
      history.replaceState(null, '', previewHref('ready'))
      setState(ready())
    }, 700)
    return () => {
      clearTimeout(timer)
    }
  }, [state.kind])

  return (
    <div class="[&_.venue-page]:min-h-[calc(100svh-2.75rem)] sm:[&_.venue-page]:min-h-[48rem]">
      <aside
        class="mx-auto flex max-w-md flex-col gap-2 px-6 py-3 text-center text-[0.6875rem] leading-5 text-[var(--fuda-muted)]"
        aria-label="Preview notice"
      >
        <p>{labels.demo}</p>
        {params.get('scene') === 'wallet' ? <p role="status">{labels.wallet}</p> : null}
        {params.get('scene') === 'browser' ? <p role="status">{labels.browser}</p> : null}
      </aside>
      {slug === 'home' ? (
        <StoreHome venue={venue} locale={locale} origin={location.origin} requested={params.get('card')} />
      ) : (
        <CardScreenView
          handle={venue.handle}
          locale={locale}
          onIssue={() => {
            if (card !== null && state.kind !== 'issuing') {
              setState({ card, kind: 'issuing' })
            }
          }}
          onReload={() => {
            setState(initialState())
          }}
          state={state}
        />
      )}
      <nav
        class="mx-auto flex max-w-md flex-wrap justify-center gap-x-5 gap-y-1 px-6 py-6 text-xs text-[var(--fuda-muted)]"
        aria-label="Preview scenarios"
      >
        {(['home', 'landing', 'ready', 'choose', 'closed', 'error', 'loading'] as const).map(
          (scene): JSX.Element => (
            <a
              key={scene}
              class="inline-flex min-h-11 items-center underline underline-offset-4"
              href={previewHref(scene)}
            >
              {labels[scene]}
            </a>
          ),
        )}
        <a
          class="inline-flex min-h-11 items-center underline underline-offset-4"
          href={`${location.pathname}?${new URLSearchParams({ cards: multiple ? 'multiple' : 'single', lang: locale === 'ja' ? 'en' : 'ja', scene: new URLSearchParams(location.search).get('scene') ?? 'landing', theme: dark ? 'dark' : 'light' })}`}
        >
          {locale === 'ja' ? 'English' : '日本語'}
        </a>
        <a
          class="inline-flex min-h-11 items-center underline underline-offset-4"
          href={`${location.pathname}?${new URLSearchParams({ cards: multiple ? 'multiple' : 'single', lang: locale, scene: new URLSearchParams(location.search).get('scene') ?? 'landing', theme: dark ? 'light' : 'dark' })}`}
        >
          {dark ? 'Light' : 'Dark'}
        </a>
      </nav>
    </div>
  )
}
