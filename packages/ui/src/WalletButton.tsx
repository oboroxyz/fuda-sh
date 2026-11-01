import type { JSX } from 'solid-js'

import { walletButton } from './wallet-button.ts'
import type { WalletButtonProps } from './wallet-button.ts'

// The markup comes from the same `hono/html` helper the server pass page uses,
// so the member app and the pass render one button. walletButton only
// interpolates synchronous primitives and escapes them.
export const WalletButton = (props: WalletButtonProps): JSX.Element => (
  <span class="flex w-full justify-center" innerHTML={String(walletButton(props))} />
)
