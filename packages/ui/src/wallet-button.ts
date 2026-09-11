import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

import { APPLE_WALLET_EN, APPLE_WALLET_JA, GOOGLE_WALLET_EN, GOOGLE_WALLET_JA } from './wallet-assets.ts'

export interface WalletButtonProps {
  platform: 'apple' | 'google'
  label: string
  locale?: 'en' | 'ja'
  href?: string
  id?: string
  hidden?: boolean
  newTab?: boolean
}

// Both the DOM app and self-contained server Pass use this markup. All dynamic
// attributes and copy are escaped by Hono; artwork is bundled, never fetched.
// Every interpolation is synchronous, so Hono returns HtmlEscapedString.
export const walletButton = ({
  platform,
  label,
  locale = 'en',
  href,
  id,
  hidden = false,
  newTab = false,
}: WalletButtonProps): HtmlEscapedString => {
  const apple = platform === 'apple'
  const appleArtwork = locale === 'ja' ? APPLE_WALLET_JA : APPLE_WALLET_EN
  const googleArtwork = locale === 'ja' ? GOOGLE_WALLET_JA : GOOGLE_WALLET_EN
  const artwork = apple ? appleArtwork : googleArtwork
  const markup = html`<a
    class="fuda-wallet-button fuda-wallet-button-${platform}"
    href="${href}"
    id="${id}"
    ${hidden ? html`hidden` : ''}
    aria-label="${label}"
    target="${newTab ? '_blank' : undefined}"
    rel="${newTab ? 'noreferrer' : undefined}"
    ><img src="${artwork}" alt="" /> <span class="fuda-wallet-label">${label}</span></a
  >`
  if (markup instanceof Promise) {
    throw new TypeError('Wallet button markup must be synchronous')
  }
  return markup
}
