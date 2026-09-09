/** @jsxImportSource hono/jsx/dom */
import { cn } from 'cn'
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
  class?: string
  labels: ThemeControlLabels
  mode: ThemeMode
  onChange: (mode: ThemeMode) => void
}

export interface LanguageOption {
  label: string
  value: string
}

export interface LanguageSwitcherProps {
  class?: string
  current: string
  label: string
  options: readonly LanguageOption[]
  onChange: (value: string) => void
}

const ThemeIcon = ({ mode }: { mode: ThemeMode }): JSX.Element => {
  if (mode === 'light') {
    return (
      <svg aria-hidden="true" data-ico="light" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="5.25" />
        <path d="M12 3v.75M12 20.25V21M3 12h.75M20.25 12H21M5.25 5.25l.75.75M18 18l.75.75M5.25 18.75l.75-.75M18 6l.75-.75" />
      </svg>
    )
  }
  if (mode === 'dark') {
    return (
      <svg aria-hidden="true" data-ico="dark" viewBox="0 0 24 24">
        <path d="M19.6 14.8A9 9 0 0 1 9.2 4.4a8.25 8.25 0 1 0 10.4 10.4ZM15 3v3M13.5 4.5h3M19.5 6.75v4.5M17.25 9h4.5" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" data-ico="system" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="m18.36 5.64-12.72 12.72M12 12v9M15 9v11.48M18 6v12.71M9 15v5.48" />
    </svg>
  )
}

const LanguageIcon = (): JSX.Element => (
  <svg aria-hidden="true" data-ico="language" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3C7 7.5 7 16.5 12 21M12 3c5 4.5 5 13.5 0 18" />
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

export const ThemeToggle = ({ class: className, labels, mode, onChange }: ThemeToggleProps): JSX.Element =>
  IconButton({
    children: ThemeIcon({ mode }),
    class: className,
    label: `${labels.control}: ${labels[mode]}`,
    onClick: () => {
      onChange(nextThemeMode(mode))
    },
  })

export const LanguageSwitcher = ({
  class: className,
  current,
  label,
  onChange,
  options,
}: LanguageSwitcherProps): JSX.Element => (
  <details class="fuda-language-menu">
    <summary aria-label={label} class={cn('fuda-icon-button', className)} title={label}>
      {LanguageIcon()}
    </summary>
    <div class="fuda-language-menu-panel">{languageOptions(current, onChange, options)}</div>
  </details>
)
