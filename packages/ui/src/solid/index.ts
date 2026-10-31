// Solid components, kept apart from the Hono barrel so a Solid app never pulls
// a `hono/jsx/dom` file through its Solid compiler (docs/adr/0009-void-and-solid.md).
// Once every app uses Solid, these replace the Hono components and this folder
// becomes the package root.
export { createQrDetector } from '../barcode.ts'
export type { BarcodeDetectorLike, DetectedBarcode } from '../barcode.ts'
export { short } from '../short.ts'
export {
  applyThemeMode,
  nextThemeMode,
  readThemeMode,
  resolveThemeMode,
  saveThemeMode,
  THEME_MODES,
  THEME_STORAGE_KEY,
  watchThemeMode,
} from '../theme.ts'
export type { ThemeEnvironment, ThemeMode } from '../theme.ts'
export type { WalletButtonProps } from '../wallet-button.ts'
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
export { FudaMark } from './FudaMark.tsx'
export { IconButton } from './IconButton.tsx'
export type { IconButtonProps } from './IconButton.tsx'
export { Scanner } from './Scanner.tsx'
export type { ScannerLabels, ScannerProps } from './Scanner.tsx'
export { WalletButton } from './WalletButton.tsx'
