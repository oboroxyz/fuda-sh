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

const themeGlyphs: Record<ThemeMode, string> = {
  dark: '☾',
  light: '☀',
  system: '◐',
}

const languageOptions = (options: readonly LanguageOption[]): JSX.Element[] => {
  const elements: JSX.Element[] = []
  for (const option of options) {
    elements.push(<option value={option.value}>{option.label}</option>)
  }
  return elements
}

export const ThemeToggle = ({ labels, mode, onChange }: ThemeToggleProps): JSX.Element =>
  IconButton({
    children: <span aria-hidden="true">{themeGlyphs[mode]}</span>,
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
  <label>
    {label}
    <select
      aria-label={label}
      onChange={(event) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Hono exposes generic Event currentTarget types.
        onChange((event.currentTarget as HTMLSelectElement).value)
      }}
      style={{ minBlockSize: '44px' }}
      value={current}
    >
      {languageOptions(options)}
    </select>
  </label>
)
