// Shared Solid components and the renderer-independent helpers the apps use.
// `wallet-button.ts` is also exported on its own path for apps/api, which
// renders it on the server with `hono/html`.
export { short } from './short.ts'
export {
  applyThemeMode,
  nextThemeMode,
  readThemeMode,
  resolveThemeMode,
  saveThemeMode,
  THEME_MODES,
  THEME_STORAGE_KEY,
  watchThemeMode,
} from './theme.ts'
export type { ThemeEnvironment, ThemeMode } from './theme.ts'
export type { WalletButtonProps } from './wallet-button.ts'
export { CardsThree } from './CardsThree.tsx'
export { ConfirmAction } from './ConfirmAction.tsx'
export type { ConfirmActionProps } from './ConfirmAction.tsx'
export { LanguageSwitcher, ThemeToggle } from './controls.tsx'
export type {
  LanguageOption,
  LanguageSwitcherProps,
  ThemeControlLabels,
  ThemeToggleProps,
} from './controls.tsx'
export { FingerprintSimple } from './FingerprintSimple.tsx'
export { PasskeySection } from './PasskeySection.tsx'
export type { PasskeySectionCopy } from './PasskeySection.tsx'
export { FudaMark } from './FudaMark.tsx'
export { IconButton } from './IconButton.tsx'
export type { IconButtonProps } from './IconButton.tsx'
export { Scanner } from './Scanner.tsx'
export type { ScannerLabels, ScannerProps } from './scanner.ts'
export { WalletButton } from './WalletButton.tsx'
