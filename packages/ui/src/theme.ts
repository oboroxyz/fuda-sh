export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]
export const THEME_STORAGE_KEY = 'fuda:theme'

export interface ThemeEnvironment {
  readStored: () => string | null
  writeStored: (mode: ThemeMode) => void
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
  readStored: () => window.localStorage.getItem(THEME_STORAGE_KEY),
  subscribeSystem: (listener) => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', listener)
    return () => {
      query.removeEventListener('change', listener)
    }
  },
  writeStored: (mode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  },
}

export const readThemeMode = (environment: ThemeEnvironment = browserThemeEnvironment): ThemeMode => {
  try {
    return resolveThemeMode(environment.readStored())
  } catch {
    return 'system'
  }
}

export const applyThemeMode = (
  mode: ThemeMode,
  environment: ThemeEnvironment = browserThemeEnvironment,
): void => {
  environment.applyRoot(mode, mode === 'dark' || (mode === 'system' && environment.prefersDark()))
}

export const saveThemeMode = (
  mode: ThemeMode,
  environment: ThemeEnvironment = browserThemeEnvironment,
): void => {
  try {
    environment.writeStored(mode)
  } catch {
    // Apply the unsaved choice for this page.
  }
  applyThemeMode(mode, environment)
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
