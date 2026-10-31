import { isLocale, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { ConfirmAction } from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import { createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

import type { MemberPassListIo } from '../member-pass-list.ts'
import { MEMBER_COPY } from './copy.ts'
import { RightsList } from './RightsList.tsx'

const SettingsIcon = (props: { kind: 'language' | 'lookup' | 'signout' | 'theme' }): JSX.Element => {
  const paths = {
    language: 'M4 5h12M10 3v2M6 5c0 6 5 10 9 11M14 5c0 6-5 10-9 11M14 21l4-10 4 10M15.5 17h5',
    lookup: 'M16 16l5 5M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0',
    signout: 'M9 4H4v16h5M10 12h11M17 8l4 4-4 4',
    theme:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  }
  return (
    <svg
      aria-hidden="true"
      class="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={paths[props.kind]} />
    </svg>
  )
}

export const Settings = (props: {
  locale: Locale
  theme: ThemeMode
  onLocaleChange: (locale: Locale) => void
  onThemeChange: (theme: ThemeMode) => void
  onSignOut: () => void
  passIo?: MemberPassListIo
}): JSX.Element => {
  const copy = (): (typeof MEMBER_COPY)[Locale] => pick(MEMBER_COPY, props.locale)
  const [lookupOpen, setLookupOpen] = createSignal(false)
  return (
    <main class="member-page member-page-narrow flex flex-col gap-8">
      <h1 class="member-heading">{copy().nav.settings}</h1>
      <section class="overflow-hidden rounded-2xl border border-[var(--fuda-border)] bg-[var(--fuda-surface)]">
        <label class="member-settings-row">
          <SettingsIcon kind="theme" />
          <span class="grow">{copy().settings.changeTheme}</span>
          <span aria-hidden="true" class="text-sm text-[var(--fuda-muted)]">
            {copy().chrome.theme[props.theme]}
          </span>
          <span aria-hidden="true" class="text-[var(--fuda-muted)]">
            ›
          </span>
          <select
            class="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={copy().settings.changeTheme}
            value={props.theme}
            onInput={(event) => {
              const { value } = event.currentTarget
              if (value === 'light' || value === 'dark' || value === 'system') {
                props.onThemeChange(value)
              }
            }}
          >
            <option value="system">{copy().chrome.theme.system}</option>
            <option value="light">{copy().chrome.theme.light}</option>
            <option value="dark">{copy().chrome.theme.dark}</option>
          </select>
        </label>
        <label class="member-settings-row">
          <SettingsIcon kind="language" />
          <span class="grow">{copy().settings.changeLanguage}</span>
          <span aria-hidden="true" class="text-sm text-[var(--fuda-muted)]">
            {props.locale === 'ja' ? '日本語' : 'English'}
          </span>
          <span aria-hidden="true" class="text-[var(--fuda-muted)]">
            ›
          </span>
          <select
            class="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={copy().settings.changeLanguage}
            value={props.locale}
            onInput={(event) => {
              const { value } = event.currentTarget
              if (isLocale(value)) {
                props.onLocaleChange(value)
              }
            }}
          >
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </label>
        <button
          class="member-settings-row"
          type="button"
          aria-expanded={lookupOpen()}
          onClick={() => {
            setLookupOpen((open) => !open)
          }}
        >
          <SettingsIcon kind="lookup" />
          <span class="grow">{copy().passes.lookupAnother}</span>
          <span aria-hidden="true" class="text-[var(--fuda-muted)]">
            {lookupOpen() ? '−' : '›'}
          </span>
        </button>
        {lookupOpen() ? (
          <div class="border-b border-[var(--fuda-border)] px-4 py-5">
            <p class="mb-4 text-sm leading-relaxed text-[var(--fuda-muted)]">
              {copy().settings.lookupDescription}
            </p>
            <RightsList
              variant="lookup"
              locale={props.locale}
              io={props.passIo}
              memory={[]}
              queryUid={null}
            />
          </div>
        ) : null}
        <ConfirmAction
          class="member-settings-row border-b-0 text-[var(--fuda-danger)]"
          icon={<SettingsIcon kind="signout" />}
          cancelLabel={copy().settings.keep}
          confirmLabel={copy().settings.signOut}
          description={copy().settings.description}
          label={copy().settings.signOut}
          title={copy().settings.title}
          onConfirm={() => {
            props.onSignOut()
          }}
        />
      </section>
    </main>
  )
}
