import { nextThemeMode } from '@fuda/ui/theme'
import type { ThemeMode } from '@fuda/ui/theme'
import { cn } from 'cn'
import type { JSX } from 'preact'
import { useRef } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'

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

const ThemeIcon = (props: { mode: ThemeMode }): JSX.Element => {
  if (props.mode === 'light') {
    return (
      <svg aria-hidden="true" data-ico="light" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="5.25" />
        <path d="M12 3v.75M12 20.25V21M3 12h.75M20.25 12H21M5.25 5.25l.75.75M18 18l.75.75M5.25 18.75l.75-.75M18 6l.75-.75" />
      </svg>
    )
  }
  if (props.mode === 'dark') {
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

export const ThemeToggle = (props: ThemeToggleProps): JSX.Element => (
  <IconButton
    class={props.class}
    label={`${props.labels.control}: ${props.labels[props.mode]}`}
    onClick={() => {
      props.onChange(nextThemeMode(props.mode))
    }}
  >
    <ThemeIcon mode={props.mode} />
  </IconButton>
)

export const LanguageSwitcher = (props: LanguageSwitcherProps): JSX.Element => {
  const menu = useRef<HTMLDetailsElement>(null)
  return (
    <details class="fuda-language-menu" ref={menu}>
      <summary aria-label={props.label} class={cn('fuda-icon-button', props.class)} title={props.label}>
        <LanguageIcon />
      </summary>
      <div class="fuda-language-menu-panel">
        {props.options.map((option) => (
          <button
            key={option.value}
            aria-current={option.value === props.current ? 'true' : undefined}
            class="fuda-language-option"
            lang={option.value}
            onClick={() => {
              if (menu.current !== null) {
                menu.current.open = false
              }
              props.onChange(option.value)
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  )
}
