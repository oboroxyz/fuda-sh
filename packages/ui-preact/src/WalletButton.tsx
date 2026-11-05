import { walletArtwork } from '@fuda/ui/wallet-button'
import type { WalletButtonProps } from '@fuda/ui/wallet-button'
import type { JSX } from 'preact'

export const WalletButton = (props: WalletButtonProps): JSX.Element => (
  <span class="flex w-full justify-center">
    <a
      aria-label={props.label}
      class={`fuda-wallet-button fuda-wallet-button-${props.platform}`}
      hidden={props.hidden ?? false}
      href={props.href}
      id={props.id}
      rel={props.newTab === true ? 'noreferrer' : undefined}
      target={props.newTab === true ? '_blank' : undefined}
    >
      <img alt="" src={walletArtwork(props.platform, props.locale ?? 'en')} />
      <span class="fuda-wallet-label">{props.label}</span>
    </a>
  </span>
)
