/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { IconButton } from './IconButton.tsx'
import { nextThemeMode } from './theme.ts'
import type { ThemeMode } from './theme.ts'

export interface ThemeControlLabels {
  control: string
  light: string
  dark: string
  system: string
}

export interface ThemeToggleProps {
  labels: ThemeControlLabels
  mode: ThemeMode
  onChange: (mode: ThemeMode) => void
}

export interface LanguageOption {
  label: string
  value: string
}

export interface LanguageSwitcherProps {
  current: string
  label: string
  options: readonly LanguageOption[]
  onChange: (value: string) => void
}

const ThemeIcon = ({ mode }: { mode: ThemeMode }): JSX.Element => {
  if (mode === 'light') {
    return (
      <svg aria-hidden="true" data-ico="light" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  }
  if (mode === 'dark') {
    return (
      <svg aria-hidden="true" data-ico="dark" viewBox="0 0 24 24">
        <path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6a8.5 8.5 0 1 0 11.6 11.6Z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" data-ico="system" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="m18.4 5.6-12.8 12.8M12 12v9M16 8v11M8 16v3" />
    </svg>
  )
}

const LanguageIcon = (): JSX.Element => (
  <svg aria-hidden="true" data-ico="language" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z" />
  </svg>
)

const hasClosest = (
  target: EventTarget | null,
): target is EventTarget & { closest: (selector: string) => Element | null } =>
  target !== null && 'closest' in target && typeof target.closest === 'function'

const isDetails = (element: Element | null): element is HTMLDetailsElement => element?.tagName === 'DETAILS'

const languageOptions = (
  current: string,
  onChange: (value: string) => void,
  options: readonly LanguageOption[],
): JSX.Element[] => {
  const elements: JSX.Element[] = []
  for (const option of options) {
    elements.push(
      <button
        aria-current={option.value === current ? 'true' : undefined}
        class="fuda-language-option"
        lang={option.value}
        onClick={(event: MouseEvent): void => {
          const menu = hasClosest(event.currentTarget) ? event.currentTarget.closest('details') : null
          if (isDetails(menu)) {
            menu.open = false
          }
          onChange(option.value)
        }}
        type="button"
      >
        {option.label}
      </button>,
    )
  }
  return elements
}

export const ThemeToggle = ({ labels, mode, onChange }: ThemeToggleProps): JSX.Element =>
  IconButton({
    children: ThemeIcon({ mode }),
    label: `${labels.control}: ${labels[mode]}`,
    onClick: () => {
      onChange(nextThemeMode(mode))
    },
  })

export const LanguageSwitcher = ({
  current,
  label,
  onChange,
  options,
}: LanguageSwitcherProps): JSX.Element => (
  <details class="fuda-language-menu">
    <summary aria-label={label} class="fuda-icon-button" title={label}>
      {LanguageIcon()}
    </summary>
    <div class="fuda-language-menu-panel">{languageOptions(current, onChange, options)}</div>
  </details>
)
