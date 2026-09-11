/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { walletButton } from './wallet-button.ts'
import type { WalletButtonProps } from './wallet-button.ts'

export const WalletButton = (props: WalletButtonProps): JSX.Element => (
  <span
    class="flex w-full justify-center"
    // walletButton only interpolates synchronous primitives and escapes them.
    dangerouslySetInnerHTML={{ __html: String(walletButton(props)) }}
  />
)
