import type { SignInFailure } from '@fuda/libs/auth'

export const SIGN_IN_FAILURE = {
  network: 'The sign-in service could not be reached. Try again.',
  rejected: 'The signature was not accepted. Request a fresh sign-in.',
  unavailable: 'The sign-in service could not verify this wallet. Try again later.',
  wallet: 'The wallet request was cancelled or unavailable. You can try again.',
} satisfies Record<SignInFailure, string>

export const THEME_LABELS = { control: 'Theme', dark: 'Dark', light: 'Light', system: 'System' } as const
