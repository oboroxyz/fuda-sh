export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export interface ThemeEnvironment {
  prefersDark: () => boolean
  applyRoot: (mode: ThemeMode, dark: boolean) => void
  subscribeSystem: (listener: () => void) => () => void
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this function validates persisted browser input
export const resolveThemeMode = (value: unknown): ThemeMode =>
  THEME_MODES.find((mode) => mode === value) ?? 'system'

export const nextThemeMode = (mode: ThemeMode): ThemeMode =>
  THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length] ?? 'system'

const browserThemeEnvironment: ThemeEnvironment = {
  applyRoot: (mode, dark) => {
    document.documentElement.dataset.themeMode = mode
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', dark)
  },
  prefersDark: () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  subscribeSystem: (listener) => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', listener)
    return () => {
      query.removeEventListener('change', listener)
    }
  },
}

export const applyThemeMode = (
  mode: ThemeMode,
  environment: ThemeEnvironment = browserThemeEnvironment,
): void => {
  environment.applyRoot(mode, mode === 'dark' || (mode === 'system' && environment.prefersDark()))
}

export const watchThemeMode = (
  mode: ThemeMode,
  environment: ThemeEnvironment = browserThemeEnvironment,
): (() => void) =>
  mode === 'system'
    ? environment.subscribeSystem(() => {
        applyThemeMode('system', environment)
      })
    : () => {
        // A non-system theme has no media-query subscription to release.
      }

// Each mode maps to a fixed script literal, so no caller-supplied text is
// written into the inline script.
const THEME_SCRIPT_ARGUMENT: Record<ThemeMode, string> = {
  dark: '"dark"',
  light: '"light"',
  system: '"system"',
}

// The inline script a server-rendered page runs before its first paint, so the
// theme is right without a flash; `system` needs the browser's media query,
// which the server cannot evaluate.
export const themeScript = (mode: ThemeMode): string =>
  `(function(m){var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.themeMode=m;r.dataset.theme=d?"dark":"light";r.classList.toggle("dark",d)})(${THEME_SCRIPT_ARGUMENT[resolveThemeMode(mode)]})`
